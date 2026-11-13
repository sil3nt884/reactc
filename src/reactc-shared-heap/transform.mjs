// Turns a Porffor C program into a shared-heap threaded one (proof of concept).
//
//   node poc/shared-heap/transform.mjs in.c out.c
//
// What changes (see shared-runtime.c for why):
// - execution state (try stack, exception, coroutines, job queue, string
//   builders, regex/JSON work buffers, allocation windows) becomes
//   thread-local, with a registry so the collector can mark other threads';
// - Porffor's static scratch arrays get a per-thread copy below the heap;
// - compiled loops poll a safepoint; the allocator's slow path takes the heap
//   lock; a collection stops the world and scans every thread;
// - builtins that change an object's structure take the structure lock.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [input, output] = process.argv.slice(2);
let lines = readFileSync(input, 'utf8').split('\n');
const report = {};
const fail = message => { throw new Error(message); };

// --- thread-local runtime state ------------------------------------------
const TLS_NAMES = new Set([
  'porf_promise_job_queue', 'porf_promise_job_head', 'porf_promise_job_len', 'porf_promise_job_cap',
  'porf_async_context', 'porf_str_builders', 'porf_str_builder_caps', 'porf_str_builder_last',
  'porf_try_data', 'porf_try_cap', 'porf_try_depth', 'porf_exception', 'porf_iter_open', 'porf_iter_base',
  'porf_c_stack_top', 'porf_coro_cur', 'porf_coro_mode', 'porf_gc_active',
]);
const TLS_PREFIXES = ['__Porffor_regex_', '__Porffor_json_', '__Porffor_dataview_', 'porf_uv_'];

// Each thread runs its own event loop: the timer module's state (its module
// globals end in _23m<hash>) and promise rejection tracking are per thread, as
// is the libuv backend's when the program links it.
let loopModule = null;
for (let i = 0; i < lines.length && !loopModule; i++) {
  const match = /^jsval p_([a-z0-9]+)_run\(void\) \{$/.exec(lines[i]);
  if (match && lines.slice(i, i + 40).some(line => line.includes('beforeExitHooks_23m' + match[1]))) loopModule = match[1];
}
let uvModule = null;
for (let i = 0; i < lines.length && !uvModule; i++) {
  if (!/\buv_run\(porf_uv_loop, UV_RUN_ONCE\)/.test(lines[i])) continue;
  for (let j = i; j >= 0; j--) {
    const header = /^jsval p_([a-z0-9]+)_[A-Za-z0-9_]+\(/.exec(lines[j]);
    if (header) { uvModule = header[1]; break; }
  }
}
const LOOP_STATE = new Set(['pendingRejections', 'rejectionHook', 'idleHook']);
const moduleSuffixes = [loopModule, uvModule].filter(Boolean).map(hash => '_23m' + hash);
const isTls = name => TLS_NAMES.has(name) || LOOP_STATE.has(name) || TLS_PREFIXES.some(prefix => name.startsWith(prefix)) ||
  moduleSuffixes.some(suffix => name.endsWith(suffix));
report.eventLoopModule = loopModule;
report.libuvModule = uvModule;

// Braces inside string and character literals (Porffor's static data) do not count.
const code = line => line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/\/\/.*$/, '');
const braces = line => { const text = code(line); return (text.match(/{/g) || []).length - (text.match(/}/g) || []).length; };
const tls = [];  // { name, type }
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (depth === 0) {
    const match = /^static ((?:struct )?[A-Za-z_][A-Za-z0-9_]*\**) ?(\**)([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])? *(=[^;]*)?;$/.exec(line);
    if (match && isTls(match[3])) {
      lines[i] = line.replace(/^static /, 'static __thread ');
      tls.push({ name: match[3] });
    }
    // static u32 a, b, c;
    const list = /^static ([A-Za-z_][A-Za-z0-9_]*) ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+);$/.exec(line);
    if (list) {
      const names = list[2].split(', ');
      if (names.every(isTls)) {
        lines[i] = line.replace(/^static /, 'static __thread ');
        for (const name of names) tls.push({ name });
      } else if (names.some(isTls)) fail('mixed thread-local declaration: ' + line);
    }
  }
  depth += braces(line);
  if (depth < 0) depth = 0;
}
for (const name of TLS_NAMES) if (!tls.some(item => item.name === name)) fail('runtime variable not found: ' + name);
report.threadLocal = tls.length;

// --- helpers ---------------------------------------------------------------
const find = (pattern, from = 0) => {
  for (let i = from; i < lines.length; i++) if (pattern.test(lines[i])) return i;
  return -1;
};
const endOf = start => {
  let level = 0;
  for (let i = start; i < lines.length; i++) {
    level += braces(lines[i]);
    if (level === 0 && code(lines[i]).includes('}')) return i;
  }
  fail('unterminated function at ' + start);
};
const bodyOf = start => lines.slice(start, endOf(start) + 1);

// Renames a function and adds a wrapper with the same signature.
function wrapFunction(name, before, after) {
  const start = find(new RegExp(`^(static (?:inline )?|PORF_NOINLINE )*[A-Za-z_][A-Za-z0-9_ ]*\\*? ?\\b${name}\\(([^)]*)\\) \\{$`));
  if (start < 0) return false;
  const header = lines[start];
  const params = /\(([^)]*)\) \{$/.exec(header)[1];
  const names = params === 'void' || params === '' ? [] : params.split(',').map(param => param.trim().split(/[ *]/).pop());
  const returnType = header.slice(0, header.indexOf(name)).replace(/\b(static|inline|PORF_NOINLINE|PORF_ONCE)\b/g, '').trim();
  const isVoid = returnType === 'void';
  lines[start] = header.replace(new RegExp(`\\b${name}\\(`), `${name}__inner(`);
  const end = endOf(start);
  const call = `${name}__inner(${names.join(', ')})`;
  const wrapper = [
    `${header.startsWith('static') ? 'static ' : ''}${returnType} ${name}(${params}) {`,
    `  ${before}`,
    isVoid ? `  ${call};` : `  ${returnType} porf_result = ${call};`,
    `  ${after}`,
    isVoid ? '' : '  return porf_result;',
    '}',
  ].filter(Boolean);
  lines.splice(end + 1, 0, ...wrapper);
  // the inner function may be used before its definition through the wrapper
  lines.splice(start, 0, `${header.replace(/ \{$/, ';').replace(new RegExp(`\\b${name}\\(`), `${name}__inner(`)}`);
  return true;
}

function replaceOnce(pattern, replacement, label) {
  const index = find(pattern);
  if (index < 0) fail('pattern not found: ' + label);
  lines[index] = lines[index].replace(pattern, replacement);
}

// --- allocator, collector and roots ----------------------------------------
replaceOnce(/if \(typeId == 0u\) memset\(MEM \+ cur, 0, porf_gc_cls_size\[ci\]\);/,
  'memset(MEM + cur, 0, porf_gc_cls_size[ci]); /* shared heap: never expose stale bytes to another thread\'s collection */',
  'zeroed allocation');
replaceOnce(/porf_gc_window_bytes \+= \(i64\)\(w->cur - w->lo\);/,
  '__atomic_fetch_add(&porf_gc_window_bytes, (i64)(w->cur - w->lo), __ATOMIC_RELAXED);', 'window bytes');
replaceOnce(/word\[PORF_GC_B_ALLOC\] \|= bits;/, '__atomic_fetch_or(&word[PORF_GC_B_ALLOC], bits, __ATOMIC_RELAXED);', 'alloc bits');
replaceOnce(/word\[PORF_GC_B_YOUNG\] \|= bits;/, '__atomic_fetch_or(&word[PORF_GC_B_YOUNG], bits, __ATOMIC_RELAXED);', 'young bits');
if (!wrapFunction('porf_alloc_slow', 'PORF_SAFEPOINT(); porf_shared_heap_lock();', 'porf_shared_heap_unlock();')) fail('porf_alloc_slow');
if (!wrapFunction('porf_gc_collect', 'porf_shared_stw_begin();', 'porf_shared_stw_end();')) fail('porf_gc_collect');
replaceOnce(/memset\(porf_str_builder_caps, 0, sizeof\(porf_str_builder_caps\)\);/,
  'memset(porf_str_builder_caps, 0, sizeof(porf_str_builder_caps)); porf_shared_clear_builders();', 'builder reset');
{
  const start = find(/^static void porf_gc_mark_cons_roots\(void\) \{$/);
  const end = endOf(start);
  lines.splice(end, 0, '  porf_shared_mark_threads();');
}

// --- exceptions release structure locks taken since the try ----------------
replaceOnce(/if \(porf_try_depth > 0\) _longjmp\(porf_try_data\[porf_try_depth - 1\], 1\);/,
  'if (porf_try_depth > 0) { porf_shared_try_unwind(porf_try_depth - 1); _longjmp(porf_try_data[porf_try_depth - 1], 1); }',
  'throw');
{
  const start = find(/^static inline jmp_buf\* porf_try_ensure\(void\) \{$/);
  if (start < 0) fail('porf_try_ensure');
  lines.splice(start + 1, 0, '  porf_shared_try_note(porf_try_depth - 1);');
}

// --- compiled functions: scratch copies and safepoints ----------------------
const compiled = [];
for (let i = 0; i < lines.length; i++) {
  if (/^(PORF_ONCE )?(jsval|i32|u32|f64|i64|void) p_[A-Za-z0-9_]+\(.*\) \{$/.test(lines[i])) {
    const end = endOf(i);
    compiled.push([i, end]);
    i = end;
  }
}
report.compiledFunctions = compiled.length;

// Static scratch arrays: re-initialised at each use (header length, entries
// pointer, capacity), so each thread can use its own copy.
const staticEnd = Number((lines.find(line => line.startsWith('const u32 porf_static_end = ')) || fail('porf_static_end')).match(/(\d+)u/)[1]);
const scratch = new Map();  // address -> bytes
for (const [start, end] of compiled) {
  for (let i = start; i <= end; i++) {
    const header = /\*\(u32\*\)\(MEM \+ (\d+)u \+ 4u\) = (\d+)u \+ 16u;/.exec(lines[i]);
    if (header && header[1] === header[2] && Number(header[1]) < staticEnd) {
      const address = Number(header[1]);
      const capacity = /\*\(i32\*\)\(MEM \+ \d+u \+ 8u\) = (\d+);/.exec(lines[i + 1] || '');
      const bytes = 16 + 8 * (capacity ? Number(capacity[1]) : 16);
      scratch.set(address, Math.max(scratch.get(address) || 0, bytes));
    }
  }
}
const addresses = [...scratch.keys()].sort((a, b) => a - b);
const tsLo = addresses.length ? addresses[0] : 0;
const tsHi = addresses.length ? Math.max(...addresses.map(address => address + scratch.get(address))) : 16;
const tsSize = Math.ceil((tsHi - tsLo) / 16) * 16 || 16;
report.scratchArrays = addresses.length;
report.scratchBytes = tsSize;
// other literal writes into static memory stay shared; listed for review
const otherStatic = new Set();
let safepoints = 0;
const tokens = addresses.length ? new RegExp(`\\b(${addresses.join('|')})u\\b`, 'g') : null;
for (const [start, end] of compiled) {
  for (let i = start + 1; i < end; i++) {
    for (const write of lines[i].matchAll(/\*\((?:i32|u32|f64|u8|u16|jsbits)\*\)\(MEM \+ (\d+)u[^=]*\) = /g)) {
      const address = Number(write[1]);
      if (address < staticEnd && !addresses.some(base => address >= base && address < base + scratch.get(base))) otherStatic.add(address);
    }
    if (tokens) lines[i] = lines[i].replace(tokens, 'PORF_TS($1u)');
    if (/^\s*(while \(.*\)|for \(.*\)|do) \{\s*$/.test(lines[i])) {
      lines[i] += ' PORF_SAFEPOINT();';
      safepoints++;
    }
  }
}
report.safepoints = safepoints;
report.sharedStaticWrites = [...otherStatic].sort((a, b) => a - b);

// The heap starts above room for every thread's scratch copy.
replaceOnce(/porf_heap_base = \(porf_static_end \+ PORF_GC_SPAGE_MASK\) & ~PORF_GC_SPAGE_MASK;/,
  'porf_heap_base = (PORF_TS_ZONE + (u32)PORF_THREAD_MAX * PORF_TS_SIZE + PORF_GC_SPAGE_MASK) & ~PORF_GC_SPAGE_MASK;',
  'heap base');

// --- structural changes take the structure lock -----------------------------
const STRUCTURAL = [
  /^p_builtins___Porffor_object_(set|setStrict|define|fastAdd|delete|setPrototype|shapeTransition|writeKey|indexAppend|removeEntry|rebuildIndex|slotWrite|spread)[A-Za-z_]*$/,
  /^p_builtins___(Map|Set|WeakMap|WeakSet)_prototype_(set|add|delete|clear)$/,
  /^p_builtins___Array_prototype_(push|pop|shift|unshift|splice|reverse|sort|fill|copyWithin)$/,
  /^porf_arr_(set|push|grow|set_len|delete)$/,
];
const defined = new Set();
for (const line of lines) {
  const match = /^(?:static (?:inline )?)?(?:jsval|i32|u32|f64|void|static u32) ?\*?([A-Za-z_][A-Za-z0-9_]*)\(.*\) \{$/.exec(line);
  if (match) defined.add(match[1]);
}
const locked = [...defined].filter(name => STRUCTURAL.some(pattern => pattern.test(name)));
for (const name of locked) wrapFunction(name, 'porf_shared_struct_lock();', 'porf_shared_struct_unlock();');
report.lockedBuiltins = locked.length;

// --- registry of thread-local state ----------------------------------------
const fields = tls.map(item => `__typeof__(${item.name}) *r_${item.name};`).join(' ');
const bind = tls.map(item => `  t->r_${item.name} = &${item.name};`);
// marking: the lines of the global root markers that touch thread-local state,
// pointed at the other thread's copy
const markLines = [];
for (const marker of ['porf_gc_mark_global_roots', 'porf_gc_mark_global_raw_roots']) {
  const start = find(new RegExp(`^static void ${marker}\\(void\\) \\{$`));
  if (start < 0) continue;
  for (const line of bodyOf(start).slice(1, -1)) {
    if (tls.some(item => new RegExp(`\\b${item.name}\\b`).test(line))) {
      markLines.push(line.replace(new RegExp(`\\b(${tls.map(item => item.name).join('|')})\\b`, 'g'), '(*t->r_$1)'));
    }
  }
}
report.markedThreadLocals = markLines.length;
// a stopped thread's promise jobs and suspended coroutines, the same way the
// collector marks its own
const tlsPattern = new RegExp(`\\b(${tls.map(item => item.name).join('|')})\\b`, 'g');
const perThreadMarkers = [];
for (const marker of ['porf_gc_mark_promise_jobs', 'porf_gc_mark_coro_roots']) {
  const start = find(new RegExp(`^static void ${marker}\\(void\\) \\{$`));
  if (start < 0) fail('marker not found: ' + marker);
  perThreadMarkers.push('  {', ...bodyOf(start).slice(1, -1).map(line => line.replace(tlsPattern, '(*t->r_$1)')), '  }');
}
const mark = [
  ...markLines,
  '  porf_gc_mark_js((*t->r_porf_exception).val, (*t->r_porf_exception).type);',
  '  porf_gc_mark_js((*t->r_porf_iter_open).val, (*t->r_porf_iter_open).type);',
  '  if (*t->r_porf_try_depth > 0) porf_gc_cons_scan_range((const u64*)*t->r_porf_try_data, (const u64*)(*t->r_porf_try_data + *t->r_porf_try_depth));',
  ...perThreadMarkers,
];

// --- each thread's event loop ----------------------------------------------
// Waiting for timers or I/O is a safe region, so a sleeping thread (main
// included) never holds up a collection. libuv callbacks only queue events in
// malloc'd memory, so they may run while a collection is in progress.
replaceOnce(/^(\s*)nanosleep\(&ts, NULL\);/m, '$1porf_shared_safe_enter(); nanosleep(&ts, NULL); porf_shared_safe_leave();', 'idle sleep');
if (uvModule) {
  replaceOnce(/\buv_run\(porf_uv_loop, UV_RUN_ONCE\);/, 'porf_shared_safe_enter(); uv_run(porf_uv_loop, UV_RUN_ONCE); porf_shared_safe_leave();', 'uv wait');
  replaceOnce(/porf_uv_loop = uv_default_loop\(\);/, 'porf_uv_loop = porf_shared_uv_loop();', 'uv loop');
}
// The uWS bridge calls request and event handlers straight from libuv
// callbacks, inside the wait's safe region: they leave it for the call.
for (const callback of ['porf_uws_on_request', 'porf_uws_on_event', 'reactc_udp_on_recv', 'reactc_udp_on_send', 'reactc_udp_on_close']) {
  const start = find(new RegExp(`^void ${callback}\\(`));
  if (start < 0) continue;
  let open = start;
  while (!lines[open].trimEnd().endsWith(') {')) open++;
  const end = endOf(start);
  if (lines.slice(open + 1, end).some(line => /return/.test(line))) fail(callback + ' returns early; cannot wrap it');
  lines.splice(end, 0, '  porf_shared_callback_exit(porf_cb);');
  lines.splice(open + 1, 0, '  const int porf_cb = porf_shared_callback_enter();');
}
// The loop modules' initialisers, in the order main runs them, set up a new
// thread's timers (and libuv backend).
const mainStart = find(/^void p__main__23main\(void\) \{$/);
if (mainStart < 0) fail('p__main__23main');
const moduleInits = bodyOf(mainStart)
  .map(line => /^\s*(p_([a-z0-9]+)__23mod_\2)\(\);$/.exec(line))
  .filter(match => match && [loopModule, uvModule].includes(match[2]))
  .map(match => match[1]);
if (loopModule && !moduleInits.some(name => name.endsWith('_' + loopModule))) fail('event loop module initialiser not called from main');
// a new thread's pendingRejections is its own empty array (main's is static)
const threadInit = [
  'static void porf_shared_thread_init(void) {',
  '  u32 a = porf_alloc(32, 72u);',
  '  *(i32*)(MEM + a) = 0; *(u32*)(MEM + a + 4u) = a + 16u; *(i32*)(MEM + a + 8u) = 2; *(i32*)(MEM + a + 12u) = 0;',
  '  memset(MEM + a + 16u, 0, 16);',
  '  pendingRejections = porf_box(a, 72);',
  '  rejectionHook = porf_box((f64)0u, 0);',
  '  idleHook = porf_box((f64)0u, 0);',
  '  porf_shared_struct_lock();',
  ...moduleInits.map(name => `  ${name}();`),
  '  porf_shared_struct_unlock();',
  '}',
  'static void porf_shared_thread_loop(void) {',
  loopModule ? `  (void)p_${loopModule}_run();` : '',
  '  (void)p_builtins___Porffor_promise_runJobs();',
  '}',
];
report.threadLoop = moduleInits;

const prelude = readFileSync(join(here, 'shared-prelude.h'), 'utf8');
const runtime = readFileSync(join(here, 'shared-runtime.c'), 'utf8');
const mainAt = find(/^int main\(int argc, char\*\* argv\) \{$/);
if (mainAt < 0) fail('main');
// Builtin prototypes and constructors are built on first use, publishing the
// pointer before their properties: another thread could see a half-built
// RegExp.prototype. They are all built when the first thread starts.
const getters = lines.map(line => /^u32 (p_builtins__23get_[A-Za-z0-9_]+)\(void\) \{$/.exec(line)?.[1]).filter(Boolean);
report.builtinsBuiltEagerly = getters.length;
const appended = [
  `#define PORF_TLS_FIELDS ${fields}`,
  'static void porf_shared_init_builtins(void) {', ...getters.map(name => `  (void)${name}();`), '}',
  ...threadInit,
  runtime,
  'static void porf_shared_bind_tls(struct porf_thread *t) {', ...bind, '}',
  'static void porf_shared_mark_tls(struct porf_thread *t) {', ...mark, '}',
];
lines.splice(mainAt, 0, ...appended);
// PORF_THREAD_MAX is needed by porf_arena_init, which comes first
const zone = `#define PORF_TS_LO ${tsLo}u\n#define PORF_TS_SIZE ${tsSize}u\n#define PORF_TS_ZONE ((porf_static_end + 15u) & ~15u)\n`;
// Porffor's version line stays first: reactc's Windows adapter checks it.
const versionLine = lines[0].startsWith('// generated by porffor') ? lines.shift() + '\n' : '';
const out = versionLine + prelude + '\nenum { PORF_THREAD_MAX = 64 };\n' + zone + lines.join('\n').replace(/\nenum \{ PORF_THREAD_MAX = 64 \};\n/, '\n');
// porf_shared_start/join/monitor are called from compiled code before the runtime
const forward = 'static int porf_shared_start(jsval fn);\nstatic jsval porf_shared_join(jsval id);\n' +
  'static void porf_shared_monitor_enter(jsval obj);\nstatic void porf_shared_monitor_exit(jsval obj);\nstatic int porf_shared_self_id(void);\n' +
  'static int porf_shared_done(jsval id);\n#ifdef UV_VERSION_MAJOR\nstatic uv_loop_t *porf_shared_uv_loop(void);\n#endif\n' +
  'static long porf_gc_stw_count;\n';
const firstCompiled = out.search(/\n(PORF_ONCE )?(jsval|i32|u32|f64|i64|void) p_[A-Za-z0-9_]+\(.*\) \{\n/);
writeFileSync(output, out.slice(0, firstCompiled + 1) + forward + out.slice(firstCompiled + 1));
console.log(JSON.stringify(report));
