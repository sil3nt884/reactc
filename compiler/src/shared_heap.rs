//! Adapts the pinned Porffor C output for the shared-heap thread runtime.

use std::collections::{BTreeMap, HashSet};
use std::sync::LazyLock;

use anyhow::{Context, Result, bail};
use regex::{Captures, Regex};

const TLS_NAMES: &[&str] = &[
    "porf_promise_job_queue",
    "porf_promise_job_head",
    "porf_promise_job_len",
    "porf_promise_job_cap",
    "porf_async_context",
    "porf_str_builders",
    "porf_str_builder_caps",
    "porf_str_builder_last",
    "porf_try_data",
    "porf_try_cap",
    "porf_try_depth",
    "porf_exception",
    "porf_iter_open",
    "porf_iter_base",
    "porf_c_stack_top",
    "porf_coro_cur",
    "porf_coro_mode",
    "porf_gc_active",
];

const FORWARD: &str = concat!(
    "static int porf_shared_start(jsval fn);\nstatic jsval porf_shared_join(jsval id);\n",
    "static void porf_shared_monitor_enter(jsval obj);\nstatic void porf_shared_monitor_exit(jsval obj);\n",
    "static int porf_shared_self_id(void);\nstatic int porf_shared_done(jsval id);\n",
    "#ifdef UV_VERSION_MAJOR\nstatic uv_loop_t *porf_shared_uv_loop(void);\n#endif\n",
    "static long porf_gc_stw_count;\n",
);

fn code(line: &str) -> std::borrow::Cow<'_, str> {
    static NON_CODE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#""(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|//.*$"#).unwrap());
    NON_CODE.replace_all(line, |token: &Captures| match token[0].as_bytes()[0] {
        b'"' => "\"\"",
        b'\'' => "''",
        _ => "",
    })
}

fn braces(line: &str) -> i32 {
    code(line)
        .bytes()
        .map(|byte| match byte {
            b'{' => 1,
            b'}' => -1,
            _ => 0,
        })
        .sum()
}

struct Source {
    lines: Vec<String>,
}

impl Source {
    fn find(&self, pattern: &Regex) -> Option<usize> {
        self.lines.iter().position(|line| pattern.is_match(line))
    }

    fn end_of(&self, start: usize) -> Result<usize> {
        let mut depth = 0;
        for (index, line) in self.lines.iter().enumerate().skip(start) {
            depth += braces(line);
            if depth == 0 && code(line).contains('}') {
                return Ok(index);
            }
        }
        bail!("unterminated function at line {}", start + 1)
    }

    fn function(&self, name: &str) -> Result<Option<(usize, usize)>> {
        let header = Regex::new(&format!(
            r"^static void {}\(void\) \{{$",
            regex::escape(name)
        ))?;
        self.find(&header)
            .map(|start| Ok((start, self.end_of(start)?)))
            .transpose()
    }

    fn replace(&mut self, from: &str, to: &str, label: &str) -> Result<()> {
        let line = self
            .lines
            .iter_mut()
            .find(|line| line.contains(from))
            .with_context(|| format!("pattern not found: {label}"))?;
        *line = line.replacen(from, to, 1);
        Ok(())
    }

    fn wrap_function(&mut self, name: &str, before: &str, after: &str) -> Result<bool> {
        let header = Regex::new(&format!(
            r"^(?:static (?:inline )?|PORF_NOINLINE )*([A-Za-z_][A-Za-z0-9_ ]*\*?) ?\b{}\(([^)]*)\) \{{$",
            regex::escape(name),
        ))?;
        let Some(start) = self.find(&header) else {
            return Ok(false);
        };
        let end = self.end_of(start)?;
        let declaration = &self.lines[start];
        let signature = header
            .captures(declaration)
            .expect("matched function header");
        let return_type = signature[1].trim();
        let params = &signature[2];
        let arguments = if params == "void" || params.is_empty() {
            Vec::new()
        } else {
            params
                .split(',')
                .map(|param| param.trim().rsplit([' ', '*']).next().unwrap())
                .collect()
        };
        let prefix = if declaration.starts_with("static") {
            "static "
        } else {
            ""
        };
        let call = format!("{name}__inner({})", arguments.join(", "));
        let mut wrapper = vec![
            format!("{prefix}{return_type} {name}({params}) {{"),
            format!("  {before}"),
        ];
        if return_type == "void" {
            wrapper.extend([format!("  {call};"), format!("  {after}")]);
        } else {
            wrapper.extend([
                format!("  {return_type} porf_result = {call};"),
                format!("  {after}"),
                "  return porf_result;".into(),
            ]);
        }
        wrapper.push("}".into());
        let inner = declaration.replacen(&format!("{name}("), &format!("{name}__inner("), 1);
        let prototype = format!("{};", inner.strip_suffix(" {").unwrap());
        self.lines[start] = inner;
        self.lines.splice(end + 1..end + 1, wrapper);
        self.lines.insert(start, prototype);
        Ok(true)
    }
}

struct LoopModules<'a> {
    timers: Option<&'a str>,
    uv: Option<&'a str>,
}

impl<'a> LoopModules<'a> {
    fn discover(input: &'a str) -> Result<Self> {
        let timer = Regex::new(r"^jsval p_([a-z0-9]+)_run\(void\) \{$")?;
        let function = Regex::new(r"^jsval p_([a-z0-9]+)_[A-Za-z0-9_]+\(")?;
        let lines: Vec<_> = input.split('\n').collect();
        let timers = lines.iter().enumerate().find_map(|(index, line)| {
            let hash = timer.captures(line)?.get(1)?.as_str();
            let hook = format!("beforeExitHooks_23m{hash}");
            lines[index..]
                .iter()
                .take(40)
                .any(|line| line.contains(&hook))
                .then_some(hash)
        });
        let uv = lines
            .iter()
            .position(|line| line.contains("uv_run(porf_uv_loop, UV_RUN_ONCE)"))
            .and_then(|index| {
                lines[..=index]
                    .iter()
                    .rev()
                    .find_map(|line| Some(function.captures(line)?.get(1)?.as_str()))
            });
        Ok(Self { timers, uv })
    }
}

fn thread_local_state(source: &mut Source, modules: &LoopModules<'_>) -> Result<Vec<String>> {
    let suffixes: Vec<_> = [modules.timers, modules.uv]
        .into_iter()
        .flatten()
        .map(|hash| format!("_23m{hash}"))
        .collect();
    let is_tls = |name: &str| {
        TLS_NAMES.contains(&name)
            || ["pendingRejections", "rejectionHook", "idleHook"].contains(&name)
            || [
                "__Porffor_regex_",
                "__Porffor_json_",
                "__Porffor_dataview_",
                "porf_uv_",
            ]
            .iter()
            .any(|prefix| name.starts_with(prefix))
            || suffixes.iter().any(|suffix| name.ends_with(suffix))
    };
    let single = Regex::new(
        r"^static (?:struct )?[A-Za-z_][A-Za-z0-9_]*\** ?\**([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])? *(?:=[^;]*)?;$",
    )?;
    let list = Regex::new(
        r"^static [A-Za-z_][A-Za-z0-9_]* ([A-Za-z_][A-Za-z0-9_]*(?:, [A-Za-z_][A-Za-z0-9_]*)+);$",
    )?;
    let mut tls = Vec::new();
    let mut depth = 0;
    for line in &mut source.lines {
        if depth == 0 {
            if let Some(names) = list.captures(line) {
                let names: Vec<_> = names[1].split(", ").collect();
                if names.iter().all(|name| is_tls(name)) {
                    tls.extend(names.into_iter().map(str::to_owned));
                    line.insert_str("static ".len(), "__thread ");
                } else if names.iter().any(|name| is_tls(name)) {
                    bail!("mixed thread-local declaration: {line}");
                }
            } else if let Some(name) = single.captures(line).filter(|name| is_tls(&name[1])) {
                tls.push(name[1].to_owned());
                line.insert_str("static ".len(), "__thread ");
            }
        }
        depth = (depth + braces(line)).max(0);
    }
    for name in TLS_NAMES {
        if !tls.iter().any(|item| item == name) {
            bail!("runtime variable not found: {name}");
        }
    }
    Ok(tls)
}

fn adapt_allocator(source: &mut Source) -> Result<()> {
    for (from, to, label) in [
        (
            "if (typeId == 0u) memset(MEM + cur, 0, porf_gc_cls_size[ci]);",
            "memset(MEM + cur, 0, porf_gc_cls_size[ci]); /* shared heap: never expose stale bytes to another thread's collection */",
            "zeroed allocation",
        ),
        (
            "porf_gc_window_bytes += (i64)(w->cur - w->lo);",
            "__atomic_fetch_add(&porf_gc_window_bytes, (i64)(w->cur - w->lo), __ATOMIC_RELAXED);",
            "window bytes",
        ),
        (
            "word[PORF_GC_B_ALLOC] |= bits;",
            "__atomic_fetch_or(&word[PORF_GC_B_ALLOC], bits, __ATOMIC_RELAXED);",
            "alloc bits",
        ),
        (
            "word[PORF_GC_B_YOUNG] |= bits;",
            "__atomic_fetch_or(&word[PORF_GC_B_YOUNG], bits, __ATOMIC_RELAXED);",
            "young bits",
        ),
    ] {
        source.replace(from, to, label)?;
    }
    for (name, before, after) in [
        (
            "porf_alloc_slow",
            "PORF_SAFEPOINT(); porf_shared_heap_lock();",
            "porf_shared_heap_unlock();",
        ),
        (
            "porf_gc_collect",
            "porf_shared_stw_begin();",
            "porf_shared_stw_end();",
        ),
    ] {
        if !source.wrap_function(name, before, after)? {
            bail!("function not found: {name}");
        }
    }
    source.replace(
        "memset(porf_str_builder_caps, 0, sizeof(porf_str_builder_caps));",
        "memset(porf_str_builder_caps, 0, sizeof(porf_str_builder_caps)); porf_shared_clear_builders();",
        "builder reset",
    )?;
    let (_, end) = source
        .function("porf_gc_mark_cons_roots")?
        .context("missing conservative root marker")?;
    source
        .lines
        .insert(end, "  porf_shared_mark_threads();".into());
    source.replace(
        "if (porf_try_depth > 0) _longjmp(porf_try_data[porf_try_depth - 1], 1);",
        "if (porf_try_depth > 0) { porf_shared_try_unwind(porf_try_depth - 1); _longjmp(porf_try_data[porf_try_depth - 1], 1); }",
        "throw",
    )?;
    let ensure_try = source
        .lines
        .iter()
        .position(|line| line == "static inline jmp_buf* porf_try_ensure(void) {")
        .context("missing porf_try_ensure")?;
    source.lines.insert(
        ensure_try + 1,
        "  porf_shared_try_note(porf_try_depth - 1);".into(),
    );
    Ok(())
}

const COMPILED_FUNCTION: &str =
    r"^(?:PORF_ONCE )?(?:jsval|i32|u32|f64|i64|void) p_[A-Za-z0-9_]+\(.*\) \{$";

fn adapt_compiled_functions(source: &mut Source) -> Result<(u64, u64)> {
    let compiled = Regex::new(COMPILED_FUNCTION)?;
    let static_end = Regex::new(r"^const u32 porf_static_end = (\d+)u")?;
    let static_end: u64 = source
        .lines
        .iter()
        .find_map(|line| static_end.captures(line))
        .context("missing porf_static_end")?[1]
        .parse()?;
    let header = Regex::new(r"\*\(u32\*\)\(MEM \+ (\d+)u \+ 4u\) = (\d+)u \+ 16u;")?;
    let capacity = Regex::new(r"\*\(i32\*\)\(MEM \+ \d+u \+ 8u\) = (\d+);")?;
    let mut functions = Vec::new();
    let mut scratch = BTreeMap::<u64, u64>::new();
    let mut index = 0;
    while let Some(offset) = source.lines[index..]
        .iter()
        .position(|line| compiled.is_match(line))
    {
        let start = index + offset;
        let end = source.end_of(start)?;
        functions.push(start + 1..end);
        for pair in source.lines[start..=end].windows(2) {
            let Some(header) = header
                .captures(&pair[0])
                .filter(|header| header[1] == header[2])
            else {
                continue;
            };
            let address: u64 = header[1].parse()?;
            if address < static_end {
                let capacity: u64 = capacity
                    .captures(&pair[1])
                    .map(|m| m[1].parse())
                    .transpose()?
                    .unwrap_or(16);
                let bytes = 16 + 8 * capacity;
                let slot = scratch.entry(address).or_default();
                *slot = (*slot).max(bytes);
            }
        }
        index = end + 1;
    }

    let token = Regex::new(r"\b([0-9]+)u\b")?;
    let back_edge = Regex::new(r"^\s*(?:while \(.*\)|for \(.*\)|do) \{\s*$")?;
    for body in functions {
        for line in &mut source.lines[body] {
            if !scratch.is_empty() {
                if let std::borrow::Cow::Owned(rewritten) =
                    token.replace_all(line, |m: &Captures| {
                        if m[1]
                            .parse()
                            .is_ok_and(|address| scratch.contains_key(&address))
                        {
                            format!("PORF_TS({})", &m[0])
                        } else {
                            m[0].to_owned()
                        }
                    })
                {
                    *line = rewritten;
                }
            }
            if back_edge.is_match(line) {
                line.push_str(" PORF_SAFEPOINT();");
            }
        }
    }
    source.replace(
        "porf_heap_base = (porf_static_end + PORF_GC_SPAGE_MASK) & ~PORF_GC_SPAGE_MASK;",
        "porf_heap_base = (PORF_TS_ZONE + (u32)PORF_THREAD_MAX * PORF_TS_SIZE + PORF_GC_SPAGE_MASK) & ~PORF_GC_SPAGE_MASK;",
        "heap base",
    )?;
    let low = scratch.first_key_value().map_or(0, |(&address, _)| address);
    let high = scratch
        .iter()
        .map(|(address, bytes)| address + bytes)
        .max()
        .unwrap_or(16);
    Ok((low, (high - low).next_multiple_of(16).max(16)))
}

fn lock_structure_changes(source: &mut Source) -> Result<()> {
    let definition = Regex::new(
        r"^(?:static (?:inline )?)?(?:jsval|i32|u32|f64|void|static u32) ?\*?([A-Za-z_][A-Za-z0-9_]*)\(.*\) \{$",
    )?;
    let structural = regex::RegexSet::new([
        r"^p_builtins___Porffor_object_(?:set|setStrict|define|fastAdd|delete|setPrototype|shapeTransition|writeKey|indexAppend|removeEntry|rebuildIndex|slotWrite|spread)[A-Za-z_]*$",
        r"^p_builtins___(?:Map|Set|WeakMap|WeakSet)_prototype_(?:set|add|delete|clear)$",
        r"^p_builtins___Array_prototype_(?:push|pop|shift|unshift|splice|reverse|sort|fill|copyWithin)$",
        r"^porf_arr_(?:set|push|grow|set_len|delete)$",
    ])?;
    let mut seen = HashSet::new();
    let locked: Vec<_> = source
        .lines
        .iter()
        .filter_map(|line| definition.captures(line))
        .map(|m| m[1].to_owned())
        .filter(|name| structural.is_match(name) && seen.insert(name.clone()))
        .collect();
    for name in locked {
        source.wrap_function(
            &name,
            "porf_shared_struct_lock();",
            "porf_shared_struct_unlock();",
        )?;
    }
    Ok(())
}

fn thread_local_registry(source: &Source, tls: &[String]) -> Result<(String, Vec<String>)> {
    let names = Regex::new(&format!(r"\b({})\b", tls.join("|")))?;
    let fields = tls
        .iter()
        .map(|name| format!("__typeof__({name}) *r_{name};"))
        .collect::<Vec<_>>()
        .join(" ");
    let mut registry = vec!["static void porf_shared_bind_tls(struct porf_thread *t) {".into()];
    registry.extend(tls.iter().map(|name| format!("  t->r_{name} = &{name};")));
    registry.extend([
        "}".into(),
        "static void porf_shared_mark_tls(struct porf_thread *t) {".into(),
    ]);
    for marker in ["porf_gc_mark_global_roots", "porf_gc_mark_global_raw_roots"] {
        if let Some((start, end)) = source.function(marker)? {
            registry.extend(
                source.lines[start + 1..end]
                    .iter()
                    .filter(|line| names.is_match(line))
                    .map(|line| names.replace_all(line, "(*t->r_$1)").into_owned()),
            );
        }
    }
    registry.extend([
        "  porf_gc_mark_js((*t->r_porf_exception).val, (*t->r_porf_exception).type);".into(),
        "  porf_gc_mark_js((*t->r_porf_iter_open).val, (*t->r_porf_iter_open).type);".into(),
        "  if (*t->r_porf_try_depth > 0) porf_gc_cons_scan_range((const u64*)*t->r_porf_try_data, (const u64*)(*t->r_porf_try_data + *t->r_porf_try_depth));".into(),
    ]);
    for marker in ["porf_gc_mark_promise_jobs", "porf_gc_mark_coro_roots"] {
        let (start, end) = source
            .function(marker)?
            .with_context(|| format!("marker not found: {marker}"))?;
        registry.push("  {".into());
        registry.extend(
            source.lines[start + 1..end]
                .iter()
                .map(|line| names.replace_all(line, "(*t->r_$1)").into_owned()),
        );
        registry.push("  }".into());
    }
    registry.push("}".into());
    Ok((fields, registry))
}

fn adapt_event_loop(source: &mut Source, modules: &LoopModules<'_>) -> Result<Vec<String>> {
    let sleep = Regex::new(r"^(\s*)nanosleep\(&ts, NULL\);")?;
    let line = source
        .lines
        .iter_mut()
        .find(|line| sleep.is_match(line))
        .context("missing idle sleep")?;
    *line = sleep
        .replace(
            line,
            "${1}porf_shared_safe_enter(); nanosleep(&ts, NULL); porf_shared_safe_leave();",
        )
        .into_owned();
    if modules.uv.is_some() {
        source.replace("uv_run(porf_uv_loop, UV_RUN_ONCE);",
            "porf_shared_safe_enter(); uv_run(porf_uv_loop, UV_RUN_ONCE); porf_shared_safe_leave();", "uv wait")?;
        source.replace(
            "porf_uv_loop = uv_default_loop();",
            "porf_uv_loop = porf_shared_uv_loop();",
            "uv loop",
        )?;
    }

    // The wait above marks the thread safe. Callbacks that reenter JS must
    // leave that region while they access the shared heap.
    let early_return = Regex::new(r"\breturn\b")?;
    for name in [
        "porf_uws_on_request",
        "porf_uws_on_event",
        "reactc_udp_on_recv",
        "reactc_udp_on_send",
        "reactc_udp_on_close",
    ] {
        let prefix = format!("void {name}(");
        let Some(start) = source
            .lines
            .iter()
            .position(|line| line.starts_with(&prefix))
        else {
            continue;
        };
        let open = source
            .lines
            .iter()
            .enumerate()
            .skip(start)
            .find_map(|(index, line)| line.trim_end().ends_with(") {").then_some(index))
            .with_context(|| format!("missing body for {name}"))?;
        let end = source.end_of(start)?;
        if open >= end
            || source.lines[open + 1..end]
                .iter()
                .any(|line| early_return.is_match(line))
        {
            bail!("{name} returns early; cannot wrap it");
        }
        source
            .lines
            .insert(end, "  porf_shared_callback_exit(porf_cb);".into());
        source.lines.insert(
            open + 1,
            "  const int porf_cb = porf_shared_callback_enter();".into(),
        );
    }

    let main = source
        .lines
        .iter()
        .position(|line| line == "void p__main__23main(void) {")
        .context("missing p__main__23main")?;
    let end = source.end_of(main)?;
    let initializer = Regex::new(r"^\s*p_([a-z0-9]+)__23mod_([a-z0-9]+)\(\);$")?;
    let initializers: Vec<_> = source.lines[main + 1..end]
        .iter()
        .filter_map(|line| {
            let captures = initializer.captures(line)?;
            let hash = captures.get(1)?.as_str();
            (hash == &captures[2] && [modules.timers, modules.uv].contains(&Some(hash)))
                .then_some(hash)
        })
        .collect();
    if let Some(timers) = modules.timers {
        if !initializers.contains(&timers) {
            bail!("event loop module initialiser not called from main");
        }
    }

    let mut code = [
        "static void porf_shared_thread_init(void) {",
        "  u32 a = porf_alloc(32, 72u);",
        "  *(i32*)(MEM + a) = 0; *(u32*)(MEM + a + 4u) = a + 16u; *(i32*)(MEM + a + 8u) = 2; *(i32*)(MEM + a + 12u) = 0;",
        "  memset(MEM + a + 16u, 0, 16);",
        "  pendingRejections = porf_box(a, 72);",
        "  rejectionHook = porf_box((f64)0u, 0);",
        "  idleHook = porf_box((f64)0u, 0);",
        "  porf_shared_struct_lock();",
    ].map(str::to_owned).to_vec();
    code.extend(
        initializers
            .iter()
            .map(|hash| format!("  p_{hash}__23mod_{hash}();")),
    );
    code.extend([
        "  porf_shared_struct_unlock();".into(),
        "}".into(),
        "static void porf_shared_thread_loop(void) {".into(),
    ]);
    if let Some(hash) = modules.timers {
        code.push(format!("  (void)p_{hash}_run();"));
    }
    code.extend([
        "  (void)p_builtins___Porffor_promise_runJobs();".into(),
        "}".into(),
    ]);
    Ok(code)
}

pub fn transform(input: &str, prelude: &str, runtime: &str) -> Result<String> {
    if !input.starts_with(crate::native::PINNED_HEADER) {
        bail!("the shared-heap adapter requires the pinned Porffor alpha-22 output");
    }
    let modules = LoopModules::discover(input)?;
    let mut source = Source {
        lines: input.split('\n').map(str::to_owned).collect(),
    };
    let tls = thread_local_state(&mut source, &modules)?;
    adapt_allocator(&mut source)?;
    let (low, size) = adapt_compiled_functions(&mut source)?;
    lock_structure_changes(&mut source)?;
    let (fields, registry) = thread_local_registry(&source, &tls)?;
    let event_loop = adapt_event_loop(&mut source, &modules)?;

    let main = source
        .lines
        .iter()
        .position(|line| line == "int main(int argc, char** argv) {")
        .context("missing main")?;
    let getter = Regex::new(r"^u32 (p_builtins__23get_[A-Za-z0-9_]+)\(void\) \{$")?;
    let mut definitions = vec![
        format!("#define PORF_TLS_FIELDS {fields}"),
        "static void porf_shared_init_builtins(void) {".into(),
    ];
    // Publish fully initialized prototypes before other threads can use them.
    definitions.extend(
        source
            .lines
            .iter()
            .filter_map(|line| getter.captures(line))
            .map(|name| format!("  (void){}();", &name[1])),
    );
    definitions.push("}".into());
    definitions.extend(event_loop);
    // The arena initializer needs the thread count before the runtime is defined.
    let thread_limit = "enum { PORF_THREAD_MAX = 64 };";
    let limit_line = format!("\n{thread_limit}\n");
    let (before_limit, after_limit) = runtime
        .split_once(&limit_line)
        .context("missing thread count in shared runtime")?;
    definitions.push(format!("{before_limit}\n{after_limit}"));
    definitions.extend(registry);
    source.lines.splice(main..main, definitions);

    let prelude_end = format!(
        "{prelude}\n{thread_limit}\n#define PORF_TS_LO {low}u\n#define PORF_TS_SIZE {size}u\n#define PORF_TS_ZONE ((porf_static_end + 15u) & ~15u)\n"
    );
    let compiled = Regex::new(COMPILED_FUNCTION)?;
    let first = source
        .find(&compiled)
        .context("missing first compiled function")?;
    let mut output = String::with_capacity(input.len());
    output.push_str(crate::native::PINNED_HEADER);
    output.push_str(&prelude_end);
    let last = source.lines.len() - 1;
    for (index, line) in source.lines.into_iter().enumerate().skip(1) {
        if index == first {
            output.push_str(FORWARD);
        }
        output.push_str(&line);
        if index != last {
            output.push('\n');
        }
    }
    Ok(output)
}
