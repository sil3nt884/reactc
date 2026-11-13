//! reactc: React (TSX) -> JavaScript bundle -> Porffor -> C -> native executable.
//!
//! Stages, in order:
//!   1. React Compiler (optional): rewrites components to memoise their work.
//!   2. oxc: parses TSX, removes types and lowers JSX to native element calls.
//!   3. rolldown: bundles the module graph with the native page runtime.
//!   4. Porffor: compiles the bundle to C.
//!   5. A C compiler links that C: alone for the build machine, or with the
//!      Skia host and the Skia library into one Windows executable.

mod bundle;
mod config;
mod css;
mod lower;
mod native;
mod scaffold;
mod wasm;
mod windows;

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Target {
    /// A bare protocol program for the machine running the build.
    Host,
    /// A self-contained Windows x64 executable with the Skia renderer.
    Windows,
    /// A WASI Preview 1 command that speaks the page protocol.
    Wasm,
}

#[derive(Clone)]
pub struct Options {
    pub entry: PathBuf,
    pub outdir: PathBuf,
    /// Repository root: holds `src/page-runtime.js`, the drivers and `tools/porf`.
    pub root: PathBuf,
    pub react_compiler: bool,
    pub native: bool,
    pub emit_c: bool,
    pub async_page: bool,
    pub http_origin: Option<String>,
    pub target: Target,
    pub server: bool,
    /// Executable file name without its extension.
    pub name: String,
    /// Window title.
    pub title: String,
    /// Folders this bundle must not include (the other side of a configured project).
    pub forbidden: Vec<PathBuf>,
    /// Set when building worker program N (1-based) of a server.
    pub worker: Option<usize>,
    /// The bundle uses the thread layer (worker_threads or fork).
    pub threads: bool,
    /// Compiled worker objects to link into the main program, in index order.
    pub worker_objects: Vec<PathBuf>,
    /// The bundle imports @reactc/threads: every thread shares one heap.
    pub shared_heap: bool,
    /// The bundle imports @reactc/native: the FFI runtime is compiled in.
    pub ffi: bool,
    /// The bundle imports node:dgram: the UDP runtime is compiled in.
    pub dgram: bool,
}

const USAGE: &str = "usage: reactc build [<entry>] [options]
       reactc new <folder> [--template NAME]   start a project (templates: reactc new --list)

  <entry>                 a UI component (.tsx, .jsx, .ts, .js) or a server module
  --config FILE           read options from FILE (default: reactc.config.json in this folder, if present)
  --only server|client    with a configuration and no entry: build one side
  --server                build <entry> as a server
  --target host|windows|wasm
                          host: this machine's protocol program; windows: a Windows .exe
                          (the default when reactc runs on Windows); wasm: a WASI module
  --outdir DIR  --root DIR  --name NAME  --title TEXT  --http-origin URL
  --async-page  --react-compiler  --native  --emit-c

Every option is also a reactc.config.json key (target, outDir, root, name, title, httpOrigin,
asyncPage, reactCompiler, native, emitC). Command-line flags override the file.";

fn is_server_module(path: &Path) -> bool {
    path.file_stem().and_then(|name| name.to_str()).is_some_and(|name| name.ends_with(".server"))
}

fn valid_origin(origin: &str) -> Result<String> {
    let pattern = regex::Regex::new(r"^https?://(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(?::[0-9]{1,5})?/?$")?;
    if origin.trim_end_matches('/').len() > 256 || !pattern.is_match(origin) {
        bail!("the HTTP origin must be an HTTP(S) origin, for example http://127.0.0.1:4000");
    }
    Ok(origin.trim_end_matches('/').to_owned())
}

fn valid_name(name: &str) -> Result<()> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c)) {
        bail!("names may contain letters, digits, dot, dash and underscore");
    }
    Ok(())
}

/// reactc's own files (`src/`, `native/`, `tools/`): `REACTC_HOME`, else the
/// nearest folder above the executable holding `src/page-runtime.js` (the
/// packaged `bin/` and the checkout's `compiler/target/*/` both resolve),
/// else the current folder.
fn default_root() -> Result<PathBuf> {
    if let Some(home) = std::env::var_os("REACTC_HOME") {
        return Ok(PathBuf::from(home));
    }
    if let Ok(executable) = std::env::current_exe() {
        for folder in executable.ancestors().skip(1).take(5) {
            if folder.join("src").join("page-runtime.js").is_file() {
                return Ok(folder.to_path_buf());
            }
        }
    }
    Ok(std::env::current_dir()?)
}

fn absolute(path: PathBuf) -> Result<PathBuf> {
    Ok(if path.is_absolute() { path } else { std::env::current_dir()?.join(path) })
}

/// Turns merged settings into a build. `configured` marks builds that come
/// from a configuration file, which always produce native output.
fn resolve(entry: PathBuf, settings: config::Settings, forbidden: Vec<PathBuf>, configured: bool,
    project_side: Option<config::Side>) -> Result<Options> {
    let entry = absolute(entry)?;
    let server = settings.server.unwrap_or(false) || is_server_module(&entry);
    let extension = entry.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    if server && !matches!(extension, "js" | "cjs" | "mjs" | "ts") {
        bail!("server entries must use .js, .cjs, .mjs, or .ts: {}", entry.display());
    }
    if !server && matches!(extension, "html" | "htm") {
        bail!("UI entries must be JavaScript or TypeScript components. HTML pages require a browser or a TSX port");
    }
    // Windows is the native target of a Windows build machine.
    let default_target = if cfg!(windows) { Target::Windows } else { Target::Host };
    let target = settings.target.unwrap_or(default_target);
    if server && target == Target::Wasm {
        bail!("server entries use --target host or --target windows");
    }
    let http_origin = settings.http_origin.as_deref().map(valid_origin).transpose()?;
    if server && (http_origin.is_some() || settings.async_page == Some(true) ||
        settings.react_compiler == Some(true) || settings.title.is_some()) {
        bail!("--async-page, --http-origin, --react-compiler and --title apply to UI entries");
    }
    // Native output when asked for, for servers, for an explicit target and
    // for configured projects; otherwise reactc only bundles.
    let native = settings.native.unwrap_or(server || configured || settings.target.is_some());
    let emit_only = settings.emit_c.unwrap_or(false);
    let stem = entry.file_stem().and_then(|s| s.to_str()).unwrap_or("app").to_owned();
    let name = settings.name.unwrap_or(stem);
    valid_name(&name)?;
    let mut outdir = absolute(settings.outdir.unwrap_or_else(|| PathBuf::from("dist/reactc")))?;
    if let Some(side) = project_side { outdir = outdir.join(side.label()); }
    Ok(Options {
        entry,
        outdir,
        root: absolute(match settings.root { Some(root) => root, None => default_root()? })?,
        react_compiler: settings.react_compiler.unwrap_or(false),
        native: native && !emit_only,
        emit_c: native || emit_only,
        // Forms and HTTP need async page mode; configured clients default to it.
        async_page: !server && (http_origin.is_some() || settings.async_page.unwrap_or(configured)),
        http_origin,
        target,
        server,
        title: settings.title.unwrap_or_else(|| name.clone()),
        name,
        forbidden,
        worker: None,
        threads: false,
        shared_heap: false,
        ffi: false,
        dgram: false,
        worker_objects: Vec::new(),
    })
}

fn parse_args() -> Result<Vec<Options>> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("build") {
        bail!("{USAGE}");
    }
    let mut cli = config::Settings::default();
    let mut entry = None;
    let mut config_path = None;
    let mut only = None;
    let value = |args: &mut dyn Iterator<Item = String>, flag: &str| args.next().with_context(|| format!("{flag} needs a value"));
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--config" => config_path = Some(PathBuf::from(value(&mut args, "--config")?)),
            "--only" => only = Some(match value(&mut args, "--only")?.as_str() {
                "server" => config::Side::Server,
                "client" => config::Side::Client,
                _ => bail!("--only must be server or client"),
            }),
            "--outdir" => cli.outdir = Some(value(&mut args, "--outdir")?.into()),
            "--root" => cli.root = Some(value(&mut args, "--root")?.into()),
            "--react-compiler" => cli.react_compiler = Some(true),
            "--native" => cli.native = Some(true),
            "--emit-c" => cli.emit_c = Some(true),
            "--server" => cli.server = Some(true),
            "--async-page" => cli.async_page = Some(true),
            "--http-origin" => cli.http_origin = Some(value(&mut args, "--http-origin")?),
            "--target" => cli.target = Some(config::parse_target(&value(&mut args, "--target")?)?),
            "--name" => cli.name = Some(value(&mut args, "--name")?),
            "--title" => cli.title = Some(value(&mut args, "--title")?),
            other if other.starts_with("--") => bail!("unknown option {other}\n{USAGE}"),
            other if entry.is_none() => entry = Some(PathBuf::from(other)),
            other => bail!("unexpected argument {other}\n{USAGE}"),
        }
    }
    if config_path.is_none() && Path::new(config::FILE_NAME).is_file() {
        config_path = Some(PathBuf::from(config::FILE_NAME));
    }
    let Some(config_path) = config_path else {
        if only.is_some() { bail!("--only needs a configuration file"); }
        let entry = entry.with_context(|| format!("missing entry file (or a {} here)\n{USAGE}", config::FILE_NAME))?;
        return Ok(vec![resolve(entry, cli, Vec::new(), false, None)?]);
    };
    let project = config::load(&config_path)?;
    eprintln!("reactc: using {}", project.path.display());
    if let Some(entry) = entry {
        // A single file: its folder decides the side and that side's options apply.
        if only.is_some() { bail!("--only applies when building the configured entries; omit the entry"); }
        let side = project.side_of(&absolute(entry.clone())?);
        let side_settings = side.and_then(|side| project.side(side)).map(|config| config.settings.clone()).unwrap_or_default();
        let settings = cli.over(&side_settings.over(&project.defaults));
        let forbidden = side.map(|side| project.forbidden(side)).unwrap_or_default();
        return Ok(vec![resolve(entry, settings, forbidden, true, None)?]);
    }
    let mut builds = Vec::new();
    for side_config in &project.sides {
        if only.is_some_and(|side| side != side_config.side) { continue; }
        let Some(entry) = side_config.entry.clone() else {
            if only.is_some() { bail!("{}: \"{}\" has no \"entry\"", project.path.display(), side_config.side.label()); }
            continue;
        };
        let settings = cli.clone().over(&side_config.settings.clone().over(&project.defaults));
        // A project with both sides builds each into its own folder, also with --only,
        // so a one-side build lands where a full build puts it.
        let several = project.sides.iter().filter(|side| side.entry.is_some()).count() > 1;
        builds.push(resolve(entry, settings, project.forbidden(side_config.side), true,
            several.then_some(side_config.side))?);
    }
    if builds.is_empty() {
        bail!("{}: no entry to build; add \"entry\" to a section or pass a file", project.path.display());
    }
    Ok(builds)
}

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().nth(1).as_deref() == Some("new") {
        return new_project();
    }
    let builds = parse_args()?;
    let several = builds.len() > 1;
    for options in builds {
        if several {
            println!("== {} build: {}", if options.server { "server" } else { "client" }, options.entry.display());
        }
        build(&options).await?;
    }
    Ok(())
}

/// `reactc new <folder> [--template NAME] [--root DIR]`, or `reactc new --list`.
fn new_project() -> Result<()> {
    let mut args = std::env::args().skip(2);
    let mut folder = None;
    let mut template = scaffold::DEFAULT_TEMPLATE.to_owned();
    let mut root = None;
    let mut list = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--template" => template = args.next().context("--template needs a name")?,
            "--root" => root = Some(PathBuf::from(args.next().context("--root needs a directory")?)),
            "--list" => list = true,
            other if other.starts_with("--") => bail!("unknown option {other}\n{USAGE}"),
            other if folder.is_none() => folder = Some(PathBuf::from(other)),
            other => bail!("unexpected argument {other}\n{USAGE}"),
        }
    }
    let root = absolute(match root { Some(root) => root, None => default_root()? })?;
    if list {
        for name in scaffold::templates(&root) {
            println!("{name}{}", if name == scaffold::DEFAULT_TEMPLATE { " (default)" } else { "" });
        }
        return Ok(());
    }
    let folder = absolute(folder.with_context(|| format!("missing project folder\n{USAGE}"))?)?;
    scaffold::create(&root, &folder, &template)?;
    let shown = folder.display();
    println!("
Next:
  cd \"{shown}\"
  powershell -ExecutionPolicy Bypass -File build.ps1 -Start    # compile the server and client, then run them
  npm run dev:server                                            # or: run the server under Node while you work
  npm run build                                                 # the same build through npm
See README.md in the project.");
    Ok(())
}

/// Refuses a bundle that includes files from the other side's folders.
fn check_boundary(options: &Options, modules: &[String]) -> Result<()> {
    let crossed: Vec<&String> = modules.iter()
        .filter(|module| options.forbidden.iter().any(|folder| config::inside(module, folder)))
        .collect();
    if crossed.is_empty() { return Ok(()); }
    let side = if options.server { "server" } else { "client" };
    let other = if options.server { "client" } else { "server" };
    let list: Vec<&str> = crossed.iter().take(8).map(|module| module.as_str()).collect();
    bail!("the {side} bundle imports {} file(s) from {other} folders:\n  {}\nMove shared code to a \"shared\" folder in {}.",
        crossed.len(), list.join("\n  "), config::FILE_NAME)
}

/// Compiles worker program `index` to an object whose only global symbol is
/// its entry, so it can share the main executable without symbol clashes.
async fn build_worker(options: &Options, index: usize, entry: &Path) -> Result<PathBuf> {
    let mut worker = options.clone();
    worker.entry = entry.to_path_buf();
    worker.worker = Some(index);
    worker.outdir = options.outdir.join(format!("worker-{index}"));
    worker.worker_objects = Vec::new();
    std::fs::create_dir_all(&worker.outdir)?;
    let report = bundle::bundle(&worker).await?;
    check_boundary(&worker, &report.modules)?;
    worker.threads = true;
    let input = worker.outdir.join("app.cjs");
    std::fs::write(&input, &report.code)?;
    println!("worker {index}: bundled {} modules from {}", report.modules.len(), entry.display());
    native::emit(&worker, &input)?;
    let object = native::compile_worker(&worker)?;
    println!("worker {index}: native object -> {}", object.display());
    Ok(object)
}

async fn build(options: &Options) -> Result<()> {
    if !options.entry.is_file() {
        bail!("entry file not found: {}", options.entry.display());
    }
    std::fs::create_dir_all(&options.outdir)?;
    let report = bundle::bundle(options).await?;
    check_boundary(options, &report.modules)?;
    let mut options = options.clone();
    let options = &mut options;
    options.threads = report.threads || !report.workers.is_empty();
    options.shared_heap = report.shared_heap;
    options.ffi = report.ffi;
    options.dgram = report.dgram;
    if options.dgram && options.target == Target::Wasm {
        bail!("node:dgram is unavailable for the WASI Preview 1 target");
    }
    if options.ffi && options.target == Target::Wasm {
        bail!("@reactc/native loads native libraries, which the WASI Preview 1 target cannot do");
    }
    if options.shared_heap {
        if !options.server {
            bail!("@reactc/threads runs in server builds (UI entries keep a single JavaScript thread)");
        }
        if options.target == Target::Wasm {
            bail!("@reactc/threads is unavailable for the WASI Preview 1 target");
        }
        if options.threads {
            bail!("@reactc/threads cannot be combined with worker_threads or child_process.fork in one program");
        }
    }
    if !report.workers.is_empty() {
        if !options.server {
            bail!("worker_threads Workers and child_process.fork run in server builds");
        }
        if options.target == Target::Wasm {
            bail!("worker threads are unavailable for the WASI Preview 1 target");
        }
        if options.native {
            for (position, entry) in report.workers.iter().enumerate() {
                let object = build_worker(options, position + 1, entry).await?;
                options.worker_objects.push(object);
            }
        }
    }
    let input = options.outdir.join("app.cjs");
    std::fs::write(&input, &report.code)?;
    println!("bundled {} modules -> {}", report.modules.len(), input.display());
    if options.react_compiler {
        println!("React Compiler: {} of {} component files rewritten", report.memoised, report.lowered);
    }
    let mut c_sources = Vec::new();
    if options.emit_c {
        c_sources = native::emit(options, &input)?;
        for source in &c_sources {
            println!("C source -> {}", options.outdir.join(source).display());
        }
    }
    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "compiler": "reactc",
        "inputs": report.modules,
        "entryKind": if options.server { "server" } else { "ui" },
        "output": if options.server { "native-server" } else { "native-page-stdio-v1" },
        "reactCompiler": options.react_compiler,
        "reactCompilerRewrote": report.memoised,
        "fallback": "not implemented",
        "nativeRequested": options.native,
        "nativeTarget": match options.target {
            Target::Host => "host",
            Target::Windows => "windows-x64",
            Target::Wasm => "wasm32-wasip1",
        },
        "cSources": c_sources,
        "asyncRequestFrames": options.async_page,
        "httpOrigin": options.http_origin,
        "workers": report.workers.iter().map(|path| path.to_string_lossy().replace('\\', "/")).collect::<Vec<_>>(),
        "threads": options.threads,
        "sharedHeap": options.shared_heap,
        "nativeLibraries": options.ffi,
        "windowsFilesystem": (options.target == Target::Windows).then_some("native UTF-8 file and directory I/O subset with separate protocol stdio"),
        "windowsThreading": (options.target == Target::Windows).then_some(serde_json::json!({
            "window": "win32-message-loop",
            "application": "compiled-core-thread",
            "hostRequests": "protocol-worker",
        })),
    });
    std::fs::write(options.outdir.join("manifest.json"), serde_json::to_string_pretty(&manifest)?)?;
    if options.native {
        let executable = native::link(options)?;
        println!("native executable -> {}", executable.display());
    }
    Ok(())
}
