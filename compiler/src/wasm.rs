//! Adapt the pinned Porffor C runtime to the WASI Preview 1 command ABI.

use anyhow::{Result, bail};
use regex::Regex;

use crate::native::PINNED_HEADER;

const STDIO: &str = r#"
#include <stdio.h>
#include <setjmp.h>

#define _setjmp setjmp
#define _longjmp longjmp

// WASI cannot duplicate stdio descriptors. Keep diagnostics off the protocol pipe.
static int porf_wasi_stderr;
static FILE *porf_wasi_output(void) { return porf_wasi_stderr ? stderr : stdout; }
#undef stdout
#define stdout (porf_wasi_output())
#define printf(...) fprintf(stdout, __VA_ARGS__)
#define putchar(c) fputc(c, stdout)

"#;

pub const ENTRY: &str = r#"#define main porffor_application_main
#include "app.wasi.c"
#undef main

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  return porffor_application_main(argc, argv);
}
"#;

pub fn adapt(source: &str) -> Result<String> {
    if !source.starts_with(PINNED_HEADER) || !source.contains("#define PORF_GC_ENABLED 0\n") {
        bail!("WASI requires the pinned Porffor C emitter with garbage collection disabled");
    }
    for (header, feature) in [
        ("uv.h", "libuv networking and child processes"),
        ("zlib.h", "native compression"),
        ("openssl/", "OpenSSL crypto and TLS"),
    ] {
        if source.contains(&format!("#include <{header}")) {
            bail!("the bundle needs {feature}, which is unavailable for WASI Preview 1");
        }
    }

    let mut source = source
        .replace("#ifdef MADV_NOHUGEPAGE", "#if defined(MADV_NOHUGEPAGE) && !defined(__wasi__)")
        .replace(
            "fflush(stdout); const int porf_out = dup(1); dup2(2, 1);",
            "fflush(stdout); porf_wasi_stderr = 1;",
        )
        .replace(
            "fflush(stdout); dup2(porf_out, 1); close(porf_out);",
            "fflush(stdout); porf_wasi_stderr = 0;",
        )
        // Path-based readFile uses the existing WASI filesystem. WASI has no dup
        // for the descriptor overload, so report the missing operation.
        .replace(": dup(o->fd);", ": (errno = ENOSYS, -1);");

    let platform_errors = Regex::new(r"(?m)^  \{ (?:ESOCKTNOSUPPORT|ESHUTDOWN|EHOSTDOWN|ENODATA), [^\n]+\n")?;
    source = platform_errors.replace_all(&source, "").into_owned();

    let ownership = Regex::new(r"(?m)^(    case PORF_FS_(?:LCHOWN|FCHOWN|CHOWN|CHMOD|FCHMOD):) [^\n]+")?;
    source = ownership.replace_all(&source, "${1} errno = ENOSYS; r = -1; break;").into_owned();
    let temp_dir = Regex::new(r"(?ms)^    case PORF_FS_MKDTEMP:\n.*?^      break;")?;
    source = temp_dir.replace(&source, "    case PORF_FS_MKDTEMP: errno = ENOSYS; r = -1; break;").into_owned();

    // The fs and stream modules can pull in process initialisation. There are
    // no terminal dimensions, POSIX user IDs, or parent process IDs in WASI.
    let terminal_size = Regex::new(r"(?ms)  struct winsize w;\n  if \(ioctl\([^\n]+\n    columns = w.ws_col;\n    rows = w.ws_row;\n  \}")?;
    source = terminal_size.replace(&source, "  (void)fd;").into_owned();
    let process_ids = Regex::new(r"out = (?:getppid|getuid|getgid|geteuid)\(\);")?;
    source = process_ids.replace_all(&source, "out = -1;").into_owned();

    // WASI linear memory has no executable-file mapping. Keep Porffor's
    // existing memcpy fallback for initialising the static heap.
    let mapping = Regex::new(r"(?ms)^static int porf_data_file\(off_t \*off\) \{\n.*?^\}")?;
    source = mapping.replace(&source, "static int porf_data_file(off_t *off) { (void)off; return -1; }").into_owned();

    source.insert_str(PINNED_HEADER.len(), STDIO);
    Ok(source)
}
