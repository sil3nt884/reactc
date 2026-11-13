//! Adapts the C that Porffor emits (written for POSIX) so it compiles as a
//! Windows x64 program. Tied to the pinned Porffor release on purpose: an
//! unexpected output shape is an error, never a silent partial port.
//!
//! This mirrors `src/windows-native.js`, which the JavaScript tooling uses.

use std::path::Path;

use anyhow::{Context, Result, bail};
use regex::{NoExpand, Regex};

use crate::native::PINNED_HEADER;

/// reactc's own C (the runtime prelude and adapters) is marked so that worker
/// programs keep it shared when their Porffor state becomes thread-local.
const SHARED_BEGIN: &str = "\n/* reactc:shared-begin */\n";
const SHARED_END: &str = "\n/* reactc:shared-end */\n";

fn rename_mingw_locals(source: &mut String) -> Result<()> {
    let locals = Regex::new(r"(?m)^  jsval (_HEX|_S_IFMT|_S_IFREG) = ")?;
    let mut functions = Vec::new();
    for local in locals.find_iter(source) {
        let prefix = &source[..local.start()];
        let Some(start) = prefix.rfind("\njsval p_") else { continue };
        if prefix[start..].contains("\n}\n") { continue; }
        let Some(end) = source[local.end()..].find("\n}\n") else { continue };
        let range = start..local.end() + end;
        if functions.last() != Some(&range) { functions.push(range); }
    }
    let tokens = Regex::new(r#""(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|//[^\n]*|/\*[\s\S]*?\*/|\b(_HEX|_S_IFMT|_S_IFREG)\b"#)?;
    for range in functions.into_iter().rev() {
        let body = tokens.replace_all(&source[range.clone()], |token: &regex::Captures| {
            match token.get(1) {
                Some(name) => format!("reactc_js{}", name.as_str()),
                None => token[0].to_owned(),
            }
        }).into_owned();
        source.replace_range(range, &body);
    }
    Ok(())
}

fn replace_function(source: &mut String, name: &str, body: &str) -> Result<()> {
    let pattern = Regex::new(&format!(
        r"(?ms)^static [^\n]+\b{}\([^\n]*\) \{{\n.*?^\}}",
        regex::escape(name)
    ))?;
    let matches: Vec<_> = pattern.find_iter(source).map(|m| m.range()).collect();
    if matches.len() > 1 {
        bail!("ambiguous Windows C adapter function: {name}");
    }
    if let Some(range) = matches.into_iter().next() {
        let signature_end = range.start + source[range.clone()].find('{').expect("pattern has a brace") + 1;
        let replacement = format!("{}\n{body}\n}}", &source[range.start..signature_end]);
        source.replace_range(range, &replacement);
    }
    Ok(())
}

pub fn adapt(source: &str, root: &Path) -> Result<String> {
    if !source.starts_with(PINNED_HEADER) {
        bail!("the Windows C adapter requires the pinned Porffor alpha-22 output");
    }
    let mut source = source.to_owned();
    // PE/COFF permits at most 8192-byte object alignment. Static data is copied
    // into the committed arena; Windows does not map pages from /proc/self/maps.
    source = source.replace("aligned(16384)", "aligned(8192)");
    replace_function(&mut source, "porf_data_file", "  return -1; // Use Porffor's existing static-data memcpy path.")?;
    replace_function(&mut source, "porf_node_rm", "  return ENOSYS;")?;
    if source.contains("static void porf_fs_run(void *arg)") {
        let start = source.find("static void porf_fs_stat_out(").context("missing Windows filesystem adapter start")?;
        let end = source[start..].find("// a path arg:").context("missing Windows filesystem adapter end")? + start;
        let adapter = std::fs::read_to_string(root.join("src").join("windows-fs.h"))?;
        source.replace_range(start..end, &format!("{SHARED_BEGIN}{adapter}{SHARED_END}"));
    }
    // Stream internals pull in process and module helpers written for POSIX.
    for (from, to) in [
        ("struct winsize w;\n  if (ioctl((i32)porf_jv_val(fd), TIOCGWINSZ, &w) == 0) {\n    columns = w.ws_col;\n    rows = w.ws_row;\n  }",
         "porf_win_console_size((i32)porf_jv_val(fd), &columns, &rows);"),
        ("getppid()", "porf_win_parent_pid()"),
        ("out = getuid()", "out = -1"), ("out = getgid()", "out = -1"), ("out = geteuid()", "out = -1"),
        ("setenv(k, v, 1);", "_putenv_s(k, v);"), ("unsetenv(k);", "_putenv_s(k, \"\");"),
        ("getcwd(NULL, 0)", "porf_win_getcwd()"),
        ("out = porf_node_cstr(dir);", "out = dir ? porf_node_cstr(dir) : JV_UNDEFINED;"),
        ("signal(SIGPIPE, SIG_IGN);", ""),
        ("realpath(p, NULL)", "porf_win_fs_realpath_utf8(p)"),
    ] {
        source = source.replace(from, to);
    }
    let executable = Regex::new(r"(?ms)^  char path\[4096\], real\[4096\];\n.*?^  out = porf_node_cstr\(realpath\(path, real\) \? real : path\);")?;
    source = executable.replace(&source, NoExpand(
        "  char *path = porf_win_executable();\n  if (path) out = porf_node_cstr(path);\n  free(path);"
    )).into_owned();
    if source.contains("const pid_t child = spawnError ? -1 : fork();") {
        let start = source.find("  // temp files, not pipes:").context("missing Windows spawn adapter start")?;
        let end = source[start..].find("  free(file);").context("missing Windows spawn adapter end")? + start;
        source.replace_range(start..end, r#"  const int modes[] = { porf_jv_val(inMode), porf_jv_val(outMode), porf_jv_val(errMode) };
  const f64 delay = porf_jv_val(timeout), limit = porf_jv_val(maxBuffer);
  spawnError = porf_win_spawn_sync(file, av, ev, dir, inData, inLen, modes,
    delay >= INT_MAX ? INT_MAX : delay > 0 ? (u64)delay : 0, limit < INT_MAX ? (size_t)limit : INT_MAX,
    (int)porf_jv_val(killSignal), &pid, &status, &termSignal, &killError, &outP, &outN, &errP, &errN);
"#);
        let spawn = std::fs::read_to_string(root.join("src").join("windows-spawn.h"))?;
        source = source.replacen("#include <uv.h>", &format!("#include <uv.h>\n{SHARED_BEGIN}{spawn}{SHARED_END}"), 1);
    }
    if source.contains("#include <uv.h>") {
        let tty = Regex::new(r"(?ms)^  i32 f = \(i32\)porf_jv_val\(fd\);\n  char path\[256\];\n.*?^  err = uv_pipe_open\(&PORF_UV_H\(handle\)->h.pipe, f\);")?;
        source = tty.replace(&source, NoExpand(
            "  const int f = _dup((int)porf_jv_val(fd));\n  err = f < 0 ? UV_EBADF : uv_pipe_open(&PORF_UV_H(handle)->h.pipe, f);\n  if (f >= 0 && err) _close(f);"
        )).into_owned();
        for (from, to) in [
            ("getsockname(fd, (struct sockaddr*)&addr, &len)", "getsockname((SOCKET)fd, (struct sockaddr*)&addr, &len)"),
            ("setsockopt(fd, IPPROTO_IPV6, IPV6_TCLASS, &v, sizeof(v))", "setsockopt((SOCKET)fd, IPPROTO_IPV6, IPV6_TCLASS, (const char*)&v, sizeof(v))"),
            ("setsockopt(fd, IPPROTO_IP, IP_TOS, &v, sizeof(v))", "setsockopt((SOCKET)fd, IPPROTO_IP, IP_TOS, (const char*)&v, sizeof(v))"),
            ("if (err) err = -errno;", "if (err) err = uv_translate_sys_error(WSAGetLastError());"),
            ("if (kill((pid_t)porf_jv_val(pid), (i32)porf_jv_val(sig)) != 0) err = errno;",
             "err = -uv_kill((int)porf_jv_val(pid), (int)porf_jv_val(sig));"),
        ] {
            source = source.replace(from, to);
        }
    }
    // Asynchronous spawn: pass Node's cmd.exe shell form verbatim, as spawnSync does.
    let async_spawn = "  const i32 err = uv_spawn(porf_uv_loop, &h->h.process, &o);";
    if source.contains(async_spawn) {
        source = source.replace(async_spawn, &format!(
            "  if (porf_win_verbatim_shell(file, args)) o.flags |= UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS;\n{async_spawn}"));
    }
    // process.resourceUsage().maxRSS: the peak working set, in bytes.
    if source.contains("getrusage(RUSAGE_SELF, &u);") {
        let rusage = "  struct rusage u;\n  getrusage(RUSAGE_SELF, &u);\n#ifdef __APPLE__\n  out = u.ru_maxrss;\n#else\n  out = u.ru_maxrss * 1024.0;\n#endif\n";
        if source.matches(rusage).count() != source.matches("getrusage(").count() {
            bail!("unexpected Porffor getrusage code for the Windows adapter");
        }
        source = source.replace(rusage,
            "  PROCESS_MEMORY_COUNTERS u = { sizeof(u) };\n  if (K32GetProcessMemoryInfo(GetCurrentProcess(), &u, sizeof(u))) out = (double)u.PeakWorkingSetSize;\n");
    }
    // tty.setRawMode: POSIX termios becomes the Windows console input mode.
    if source.contains("#include <termios.h>") {
        let declaration = "#include <termios.h>\n\nstatic struct termios porf_tty_orig[3];";
        if !source.contains(declaration) {
            bail!("unexpected Porffor termios declaration for the Windows adapter");
        }
        source = source.replace(declaration, "static DWORD porf_tty_orig[3];");
        let raw = Regex::new(r"(?ms)^  struct termios t;\n  if \(tcgetattr\(f, &t\) != 0\) err = errno;\n.*?^    if \(tcsetattr\(f, TCSADRAIN, &t\) != 0\) err = errno;\n  \}\n")?;
        if raw.find_iter(&source).count() != 1 {
            bail!("unexpected Porffor tty raw-mode code for the Windows adapter");
        }
        source = raw.replace(&source, NoExpand(
            "  HANDLE console = (HANDLE)_get_osfhandle(f);\n  DWORD mode = 0;\n  if (console == INVALID_HANDLE_VALUE || !GetConsoleMode(console, &mode)) err = ENOTTY;\n  else {\n    if (porf_jv_val(raw) != 0) {\n      if (f < 3) porf_tty_orig[f] = mode;\n      mode &= ~(DWORD)(ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT | ENABLE_PROCESSED_INPUT);\n      mode |= ENABLE_VIRTUAL_TERMINAL_INPUT;\n    } else if (f < 3) mode = porf_tty_orig[f];\n    if (!SetConsoleMode(console, mode)) err = EIO;\n  }\n"
        )).into_owned();
    }
    source = Regex::new(r"\bgetentropy\(")?.replace_all(&source, NoExpand("porf_win_entropy(")).into_owned();
    if source.contains("X509_STORE_set_default_paths(porf_tls_roots);") {
        let trust = std::fs::read_to_string(root.join("src").join("windows-tls.h"))?;
        source = source.replace("X509_STORE_set_default_paths(porf_tls_roots);",
            "X509_STORE_set_default_paths(porf_tls_roots);\n    porf_win_tls_roots(porf_tls_roots);")
            .replacen("#include <openssl/ssl.h>", &format!("#include <openssl/ssl.h>\n{SHARED_BEGIN}{trust}{SHARED_END}"), 1);
    }
    for header in ["sys/random.h", "sys/mman.h", "sys/wait.h", "sys/resource.h", "sys/utsname.h", "sys/ioctl.h"] {
        source = source.replace(&format!("#include <{header}>"), "");
    }
    // These POSIX constants only fill imported node module tables. Unsupported
    // signal and flag entries become -1, never successful no-op operations.
    let supported = ["SIGINT", "SIGILL", "SIGABRT", "SIGFPE", "SIGSEGV", "SIGTERM", "SIGKILL"];
    let table = Regex::new(r"(?s)static const i32 porf_node_signals\[\] = \{.*?\n\};")?;
    let signal = Regex::new(r"\bSIG[A-Z0-9]+\b")?;
    source = table
        .replace_all(&source, |found: &regex::Captures| {
            signal
                .replace_all(&found[0], |name: &regex::Captures| {
                    if supported.contains(&&name[0]) { name[0].to_owned() } else { "(-1)".to_owned() }
                })
                .into_owned()
        })
        .into_owned();
    for name in ["ESOCKTNOSUPPORT", "ESHUTDOWN", "EHOSTDOWN"] {
        let line = Regex::new(&format!(r"(?m)^  \{{ {name},.*\n"))?;
        source = line.replace_all(&source, NoExpand("")).into_owned();
    }
    for name in ["O_NOCTTY", "O_DIRECTORY", "O_NOFOLLOW", "O_SYNC", "O_DSYNC", "O_NONBLOCK"] {
        let word = Regex::new(&format!(r"\b{name}\b"))?;
        source = word.replace_all(&source, NoExpand("(-1)")).into_owned();
    }
    source = source.replace("_setjmp(", "setjmp(").replace("_longjmp(", "longjmp(");
    // Porffor may use MinGW macro names for JavaScript locals. Rename only
    // identifier tokens inside generated JavaScript functions. Native C
    // helpers still use the original header macros.
    rename_mingw_locals(&mut source)?;
    // The in-process console wrappers bypass CRT descriptor redirection.
    source = source.replace("fflush(stdout); const int porf_out = dup(1); dup2(2, 1);", "PORF_CONSOLE_STDERR_BEGIN;")
        .replace("fflush(stdout); dup2(porf_out, 1); close(porf_out);", "PORF_CONSOLE_STDERR_END;");
    let runtime = root.join("src").join("windows-runtime.h");
    let header = std::fs::read_to_string(&runtime).with_context(|| format!("cannot read {}", runtime.display()))?;
    Ok(format!("{SHARED_BEGIN}{header}{SHARED_END}{source}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn renames_javascript_locals_without_changing_native_macro_uses() {
        let mut source = "\njsval p_app(void) {\n  jsval _HEX = JV_UNDEFINED;\n  jsval _S_IFMT = _HEX;\n  print(\"_HEX\");\n}\nstatic int mode(void) {\n  return _S_IFMT;\n}\n".to_owned();
        super::rename_mingw_locals(&mut source).unwrap();
        assert!(source.contains("jsval reactc_js_S_IFMT = reactc_js_HEX;"));
        assert!(source.contains("print(\"_HEX\");"));
        assert!(source.contains("return _S_IFMT;"));
    }
}
