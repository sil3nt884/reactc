//! Bundles the lowered module graph with the native page runtime.

use std::borrow::Cow;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, anyhow, bail};
use rolldown::plugin::{
    HookLoadArgs, HookLoadOutput, HookLoadReturn, HookResolveIdArgs, HookResolveIdOutput,
    HookResolveIdReturn, HookUsage, Plugin, PluginContext, SharedLoadPluginContext,
};
use rolldown::{
    Bundler, BundlerOptions, InjectImport, InlineConstOption, InputItem, ModuleType, OptimizationOption,
    OutputFormat, Platform, ResolveOptions,
};

use crate::Options;
use crate::lower::{JSX_FACTORY, JSX_FRAGMENT, lower};

const ENTRY_ID: &str = "\0reactc:entry";
const FETCH_ID: &str = "\0reactc:fetch";
const NODE_ID: &str = "\0reactc:node:";
const LIB_ID: &str = "\0reactc:lib:";
/// A worker program's entry: the thread layer first, then the worker module.
const WORKER_ENTRY_ID: &str = "\0reactc:worker-entry";

/// Node builtins reactc replaces in server builds: (name, file under src/).
/// Windows servers get Node's Windows path, url and shell behaviour; every
/// server gets worker_threads and child_process.fork as native threads.
fn server_library(specifier: &str, windows: bool) -> Option<(&'static str, &'static str)> {
    match specifier.strip_prefix("node:").unwrap_or(specifier) {
        "path" | "path/win32" if windows => Some(("path", "node-win32/path.js")),
        "url" if windows => Some(("url", "node-win32/url.js")),
        "child_process" if windows => Some(("child_process", "node-win32/child_process.js")),
        "child_process" => Some(("child_process", "node-threads/child_process.js")),
        "worker_threads" => Some(("worker_threads", "node-threads/worker_threads.js")),
        // Internal: the thread layer's message codec. No package can be named this.
        "reactc:clone" => Some(("reactc:clone", "node-threads/clone.js")),
        // Shared-heap threads; importing them builds the program with the shared heap.
        "reactc:threads" | "@reactc/threads" => Some(("reactc:threads", "../packages/reactc-threads/src/index.js")),
        _ => None,
    }
}

fn node_global(module: &str) -> String {
    format!("__reactc_node_{}", module.replace('/', "_"))
}

pub struct Report {
    pub code: String,
    pub modules: Vec<String>,
    pub lowered: usize,
    pub memoised: usize,
    /// Literal worker and fork entries, in index order (1-based in the code).
    pub workers: Vec<PathBuf>,
    /// The bundle includes the thread layer and needs the thread runtime.
    pub threads: bool,
    /// The bundle imports @reactc/threads: one heap shared by every thread.
    pub shared_heap: bool,
}

/// A path written into generated JavaScript as an import specifier.
fn specifier(path: &Path) -> String {
    serde_json::to_string(&path.to_string_lossy().replace('\\', "/")).expect("path is a string")
}

/// What the plugin observed, shared with the caller after the build.
#[derive(Debug, Default)]
struct Observed {
    modules: Mutex<Vec<String>>,
    lowered: AtomicUsize,
    memoised: AtomicUsize,
    failures: Mutex<Vec<String>>,
    node_modules: Mutex<BTreeSet<String>>,
    workers: Mutex<Vec<PathBuf>>,
    threads: std::sync::atomic::AtomicBool,
    shared_heap: std::sync::atomic::AtomicBool,
}

#[derive(Debug)]
struct NativePlugin {
    entry: PathBuf,
    page_runtime: PathBuf,
    compiler_runtime: PathBuf,
    http_origin: Option<String>,
    async_page: bool,
    windows: bool,
    /// Title for the default window frame of Windows apps without a WindowTitleBar.
    window_title: String,
    react_compiler: bool,
    wasm: bool,
    server: bool,
    /// Building a worker program, whose entry loads the thread layer first.
    worker: bool,
    seen: Arc<Observed>,
}

impl Plugin for NativePlugin {
    fn name(&self) -> Cow<'static, str> {
        "reactc-native".into()
    }

    fn register_hook_usage(&self) -> HookUsage {
        HookUsage::ResolveId | HookUsage::Load
    }

    async fn resolve_id(&self, _ctx: &PluginContext, args: &HookResolveIdArgs<'_>) -> HookResolveIdReturn {
        if self.server {
            if args.specifier == WORKER_ENTRY_ID || args.specifier.starts_with(LIB_ID) {
                return Ok(Some(HookResolveIdOutput::from_id(args.specifier)));
            }
            // A replacement imports the builtin it replaces from Porffor; every
            // other builtin is left for Porffor to resolve.
            if let Some((name, _)) = server_library(args.specifier, self.windows) {
                let id = format!("{LIB_ID}{name}");
                if args.importer != Some(id.as_str()) {
                    return Ok(Some(HookResolveIdOutput::from_id(id)));
                }
            }
            return Ok(None);
        }
        if let Some(module) = args.specifier.strip_prefix("node:") {
            if self.wasm && !matches!(module, "fs" | "fs/promises" | "stream") {
                bail!("{} is unavailable for the WASI Preview 1 target", args.specifier);
            }
            match module {
                "fs" | "fs/promises" | "stream" | "net" | "child_process" |
                "zlib" | "crypto" | "http" | "https" => {},
                _ => bail!("{} is unavailable for this reactc target", args.specifier),
            }
            return Ok(Some(HookResolveIdOutput::from_id(format!("{NODE_ID}{module}"))));
        }
        let target = match args.specifier {
            ENTRY_ID => return Ok(Some(HookResolveIdOutput::from_id(ENTRY_ID))),
            FETCH_ID if self.http_origin.is_some() => return Ok(Some(HookResolveIdOutput::from_id(FETCH_ID))),
            // The native runtime stands in for React. No React package is bundled.
            "react" | "react-dom" | "react/jsx-runtime" | "react/jsx-dev-runtime" => &self.page_runtime,
            "react/compiler-runtime" => &self.compiler_runtime,
            _ => return Ok(None),
        };
        // Use the platform's own spelling so this is the same module the
        // resolver finds through a relative import.
        Ok(Some(HookResolveIdOutput::from_id(target.to_string_lossy().into_owned())))
    }

    async fn load(&self, _ctx: SharedLoadPluginContext, args: &HookLoadArgs<'_>) -> HookLoadReturn {
        if args.id == ENTRY_ID {
            let frame = if self.windows {
                format!(", windowFrame: {{ title: {} }}", serde_json::to_string(&self.window_title)?)
            } else {
                String::new()
            };
            let code = format!(
                "import App from {};\nimport {{ createPage }} from {};\nexport const page = createPage(App, {{ asyncPage: {}, standardChildren: true, openExternal: {}, initialProps: {{}}{} }});\n",
                specifier(&self.entry),
                specifier(&self.page_runtime),
                self.async_page,
                self.windows,
                frame,
            );
            return Ok(Some(HookLoadOutput { code: code.into(), module_type: Some(ModuleType::Js), ..Default::default() }));
        }
        if args.id == FETCH_ID {
            let origin = self.http_origin.as_ref().expect("fetch enabled");
            let runtime = specifier(&self.page_runtime.with_file_name("reactc-fetch.js"));
            let code = format!("import {{ createFetch }} from {runtime};\nexport {{ Headers }} from {runtime};\nexport const fetch = createFetch({});\n",
                serde_json::to_string(origin)?);
            return Ok(Some(HookLoadOutput { code: code.into(), module_type: Some(ModuleType::Js), ..Default::default() }));
        }
        if args.id == WORKER_ENTRY_ID {
            let code = format!("import {};\nimport {};\n",
                serde_json::to_string(&format!("{LIB_ID}worker_threads"))?, specifier(&self.entry));
            return Ok(Some(HookLoadOutput { code: code.into(), module_type: Some(ModuleType::Js), ..Default::default() }));
        }
        if let Some(name) = args.id.strip_prefix(LIB_ID) {
            let (_, relative) = server_library(name, self.windows)
                .with_context(|| format!("no reactc replacement for {name}"))?;
            let file = self.page_runtime.with_file_name(relative);
            let code = std::fs::read_to_string(&file).map_err(|error| anyhow!("{}: {error}", file.display()))?
                // The layer's modules import each other through their virtual IDs.
                .replace("from './path.js'", &format!("from {}", serde_json::to_string(&format!("{LIB_ID}path"))?))
                .replace("from './clone.js'", &format!("from {}", serde_json::to_string(&format!("{LIB_ID}reactc:clone"))?));
            if name == "worker_threads" { self.seen.threads.store(true, Ordering::Relaxed); }
            if name == "reactc:threads" { self.seen.shared_heap.store(true, Ordering::Relaxed); }
            self.seen.modules.lock().unwrap().push(relative.to_owned());
            return Ok(Some(HookLoadOutput { code: code.into(), module_type: Some(ModuleType::Js), ..Default::default() }));
        }
        if let Some(module) = args.id.strip_prefix(NODE_ID) {
            self.seen.node_modules.lock().unwrap().insert(module.into());
            let code = format!("module.exports = {};", node_global(module));
            return Ok(Some(HookLoadOutput { code: code.into(), module_type: Some(ModuleType::Js), ..Default::default() }));
        }
        if std::env::var_os("REACTC_TRACE").is_some() { eprintln!("load {:?}", args.id); }
        let path = Path::new(args.id);
        if !self.server && crate::is_server_module(path) {
            let message = format!("UI entries cannot import server module {}. Call it over HTTP", path.display());
            self.seen.failures.lock().unwrap().push(message.clone());
            bail!("{message}");
        }
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        self.seen.modules.lock().unwrap().push(args.id.replace('\\', "/"));
        if !self.server && extension == "css" {
            let source = std::fs::read_to_string(path)?;
            let (rules, warnings) = crate::css::compile(&source, args.id)?;
            if !warnings.is_empty() {
                eprintln!("native CSS {}: unsupported {}", args.id, warnings.into_iter().collect::<Vec<_>>().join(", "));
            }
            let code = format!("import {{ registerStylesheet }} from {}; registerStylesheet({});",
                specifier(&self.page_runtime.with_file_name("native-css.js")), serde_json::to_string(&rules)?);
            return Ok(Some(HookLoadOutput { code: code.into(), module_type: Some(ModuleType::Js), ..Default::default() }));
        }
        if self.server && matches!(extension, "js" | "mjs" | "cjs" | "ts" | "mts" | "cts" | "tsx" | "jsx") &&
            !args.id.replace('\\', "/").contains("/node_modules/") {
            let source = std::fs::read_to_string(path).map_err(|error| anyhow!("{}: {error}", path.display()))?;
            let mut changed = None;
            // Literal worker and fork entries become numbered native programs.
            let entries = crate::lower::find_thread_entries(path, &source);
            if !entries.is_empty() {
                if self.worker {
                    bail!("{}: a worker cannot start workers or forked children yet", path.display());
                }
                let folder = path.parent().unwrap_or(Path::new("."));
                let mut text = String::new();
                let mut cursor = 0;
                for entry in entries {
                    let target = folder.join(&entry.specifier);
                    let target = std::fs::canonicalize(&target).map_err(|_| anyhow!(
                        "{}: worker module {} was not found", path.display(), entry.specifier))?;
                    let target = PathBuf::from(target.to_string_lossy().trim_start_matches(r"\\?\"));
                    let index = {
                        let mut workers = self.seen.workers.lock().unwrap();
                        match workers.iter().position(|known| *known == target) {
                            Some(position) => position + 1,
                            None => { workers.push(target.clone()); workers.len() }
                        }
                    };
                    let shown = target.to_string_lossy().trim_start_matches(r"\\?\").replace('\\', "/");
                    text.push_str(&source[cursor..entry.start]);
                    text.push_str(&format!("{{ __reactcWorker: {index}, filename: {} }}", serde_json::to_string(&shown)?));
                    cursor = entry.end;
                }
                text.push_str(&source[cursor..]);
                changed = Some(text);
            }
            if std::fs::canonicalize(path).ok() == std::fs::canonicalize(&self.entry).ok() {
                let current = changed.as_deref().unwrap_or(&source);
                if let Some(wrapped) = crate::lower::wrap_top_level_await(path, current)? {
                    changed = Some(wrapped);
                }
            }
            if let Some(text) = changed {
                let code = match lower(path, &text, false)? {
                    Some(lowered) => lowered.code,
                    None => text,
                };
                return Ok(Some(HookLoadOutput { code: code.into(), module_type: Some(ModuleType::Js), ..Default::default() }));
            }
        }
        if !matches!(extension, "tsx" | "ts" | "jsx") && (self.server || extension != "js") {
            return Ok(None);
        }
        let source = std::fs::read_to_string(path).map_err(|error| anyhow!("{}: {error}", path.display()))?;
        match lower(path, &source, self.react_compiler) {
            Ok(Some(lowered)) => {
                self.seen.lowered.fetch_add(1, Ordering::Relaxed);
                if lowered.memoised {
                    self.seen.memoised.fetch_add(1, Ordering::Relaxed);
                }
                Ok(Some(HookLoadOutput { code: lowered.code.into(), module_type: Some(ModuleType::Js), ..Default::default() }))
            }
            Ok(None) => Ok(None),
            Err(error) => {
                self.seen.failures.lock().unwrap().push(format!("{error:#}"));
                Err(error)?
            }
        }
    }
}

pub async fn bundle(options: &Options) -> Result<Report> {
    // Joined a component at a time: a mixed-separator path would be a second
    // module id for the same file, and the runtime would be bundled twice.
    let source = options.root.join("src");
    let page_runtime = source.join("page-runtime.js");
    let compiler_runtime = source.join("react-compiler-runtime.js");
    let driver = source.join("drivers").join(if options.async_page { "async-page-driver.js" } else { "page-driver.js" });
    if !options.server {
        for required in [&page_runtime, &compiler_runtime, &driver] {
            if !required.is_file() {
                bail!("missing runtime file {} (is --root the repository root?)", required.display());
            }
        }
    }
    let runtime_id = page_runtime.to_string_lossy().into_owned();
    let seen = Arc::new(Observed::default());
    let plugin = Plugin::new_shared(NativePlugin {
        entry: options.entry.clone(),
        page_runtime: page_runtime.clone(),
        compiler_runtime,
        http_origin: options.http_origin.clone(),
        async_page: options.async_page,
        windows: options.target == crate::Target::Windows,
        // The same characters the Windows host keeps for its caption.
        window_title: options.title.chars().filter(|c| c.is_ascii_alphanumeric() || " ._-".contains(*c)).collect(),
        react_compiler: options.react_compiler,
        wasm: options.target == crate::Target::Wasm,
        server: options.server,
        worker: options.worker.is_some(),
        seen: seen.clone(),
    });
    // Inject imports only for unresolved identifiers, leaving local fetch bindings alone.
    let mut inject = if options.server { Vec::new() } else {
        vec![
            InjectImport::named(JSX_FACTORY.into(), None, runtime_id.clone()),
            InjectImport::named(JSX_FRAGMENT.into(), None, runtime_id.clone()),
        ]
    };
    if options.http_origin.is_some() {
        inject.push(InjectImport::named("fetch".into(), None, FETCH_ID.into()));
        inject.push(InjectImport::named("Headers".into(), None, FETCH_ID.into()));
    }
    if !options.server {
        inject.push(InjectImport::named("nativeWindow".into(), Some("window".into()), runtime_id.clone()));
        let console_id = source.join("native-console.js").to_string_lossy().into_owned();
        inject.push(InjectImport::named("console".into(), None, console_id));
        for (exported, global) in [
            ("nativeDocument", "document"), ("nativeStorage", "localStorage"),
            ("nativeAlert", "alert"), ("nativeConfirm", "confirm"),
        ] {
            inject.push(InjectImport::named(exported.into(), Some(global.into()), runtime_id.clone()));
        }
    }
    let mut bundler = Bundler::with_plugins(
        BundlerOptions {
            input: Some(vec![InputItem {
                name: Some("app".into()),
                import: if options.worker.is_some() {
                    WORKER_ENTRY_ID.into()
                } else if options.server {
                    options.entry.to_string_lossy().replace('\\', "/")
                } else {
                    ENTRY_ID.into()
                },
            }]),
            cwd: Some(options.root.clone()),
            format: Some(if options.server { OutputFormat::Cjs } else { OutputFormat::Iife }),
            name: Some("NativeApp".into()),
            platform: Some(if options.server { Platform::Node } else { Platform::Neutral }),
            // Neutral selects neither browser shims nor a package entry by
            // default. Older packages still publish a module or main field.
            resolve: (!options.server).then(|| ResolveOptions {
                main_fields: Some(vec!["module".into(), "main".into()]),
                ..Default::default()
            }),
            // Porffor optimises the program. The bundler only links modules.
            optimization: Some(OptimizationOption { inline_const: Some(InlineConstOption::Bool(false)), ..Default::default() }),
            // Lowered JSX calls the runtime's element factory in every module.
            inject: Some(inject),
            ..Default::default()
        },
        vec![plugin],
    )
    .map_err(|errors| anyhow!("cannot configure bundler: {errors:?}"))?;

    let output = match bundler.generate().await {
        Ok(output) => output,
        Err(errors) => {
            let failures = seen.failures.lock().unwrap();
            if !failures.is_empty() {
                bail!("{}", failures.join("\n"));
            }
            bail!("bundling failed: {errors:?}");
        }
    };
    for warning in &output.warnings {
        eprintln!("bundler warning: {warning:?}");
    }
    let mut chunks = output.assets.iter().filter_map(|asset| match asset {
        rolldown_common::Output::Chunk(chunk) => Some(chunk),
        rolldown_common::Output::Asset(_) => None,
    });
    let (Some(chunk), None) = (chunks.next(), chunks.next()) else {
        bail!("expected the app to bundle into exactly one chunk");
    };
    let mut modules = seen.modules.lock().unwrap().clone();
    modules.sort();
    let mut prelude = String::new();
    let node_modules = seen.node_modules.lock().unwrap();
    if node_modules.contains("crypto") || chunk.imports.iter().any(|name| matches!(name.as_str(), "crypto" | "node:crypto")) {
        prelude.push_str(include_str!("../../src/reactc-crypto-compat.js"));
        prelude.push('\n');
    }
    for module in node_modules.iter() {
        prelude.push_str(&format!("var {} = require('node:{module}');\n", node_global(module)));
        modules.push(format!("node:{module}"));
    }
    let driver = if options.server { String::new() } else {
        std::fs::read_to_string(source.join("drivers").join("stdio.js"))? + &std::fs::read_to_string(driver)?
    };
    Ok(Report {
        code: format!("{prelude}{}\n{driver}", chunk.code),
        modules,
        lowered: seen.lowered.load(Ordering::Relaxed),
        memoised: seen.memoised.load(Ordering::Relaxed),
        workers: seen.workers.lock().unwrap().clone(),
        threads: seen.threads.load(Ordering::Relaxed),
        shared_heap: seen.shared_heap.load(Ordering::Relaxed),
    })
}
