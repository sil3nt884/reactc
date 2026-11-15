//! `reactc.config.json`: every command-line option as a configuration key,
//! plus which folders hold server code and which hold client code.
//!
//! ```json
//! {
//!   "target": "windows",
//!   "outDir": "dist/my-app",
//!   "shared": ["shared"],
//!   "server": { "folders": ["server"], "entry": "server/index.ts", "name": "MyAppServer" },
//!   "client": { "folders": ["src"], "entry": "src/App.tsx", "name": "MyApp", "title": "My app",
//!               "httpOrigin": "http://127.0.0.1:5000" }
//! }
//! ```
//!
//! Top-level options apply to every build, a `server` or `client` section
//! overrides them for that side, and command-line flags override both. Paths
//! are relative to the configuration file. A client bundle may not include
//! files from server folders and a server bundle may not include files from
//! client folders; shared folders and packages are open to both.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde_json::{Map, Value};

use crate::Target;

pub const FILE_NAME: &str = "reactc.config.json";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Side {
    Server,
    Client,
}

impl Side {
    pub fn label(self) -> &'static str {
        match self {
            Side::Server => "server",
            Side::Client => "client",
        }
    }
}

/// Build options, each unset until a layer provides it.
#[derive(Clone, Default, Debug)]
pub struct Settings {
    pub target: Option<Target>,
    pub outdir: Option<PathBuf>,
    pub root: Option<PathBuf>,
    pub react_compiler: Option<bool>,
    pub native: Option<bool>,
    pub emit_c: Option<bool>,
    pub console: Option<bool>,
    pub name: Option<String>,
    pub title: Option<String>,
    pub async_page: Option<bool>,
    pub http_origin: Option<String>,
    pub server: Option<bool>,
}

impl Settings {
    /// `self` wins; unset fields come from `base`.
    pub fn over(self, base: &Settings) -> Settings {
        Settings {
            target: self.target.or(base.target),
            outdir: self.outdir.or_else(|| base.outdir.clone()),
            root: self.root.or_else(|| base.root.clone()),
            react_compiler: self.react_compiler.or(base.react_compiler),
            native: self.native.or(base.native),
            emit_c: self.emit_c.or(base.emit_c),
            console: self.console.or(base.console),
            name: self.name.or_else(|| base.name.clone()),
            title: self.title.or_else(|| base.title.clone()),
            async_page: self.async_page.or(base.async_page),
            http_origin: self.http_origin.or_else(|| base.http_origin.clone()),
            server: self.server.or(base.server),
        }
    }
}

/// Option keys accepted at the top level and in either section.
const OPTION_KEYS: &[&str] = &[
    "target", "outDir", "root", "reactCompiler", "native", "emitC", "console", "name", "title", "asyncPage", "httpOrigin",
];
/// Options that only apply to user interfaces.
const CLIENT_ONLY: &[&str] = &["title", "asyncPage", "httpOrigin", "reactCompiler"];

pub struct SideConfig {
    pub side: Side,
    pub folders: Vec<PathBuf>,
    pub entry: Option<PathBuf>,
    pub settings: Settings,
}

pub struct Project {
    pub path: PathBuf,
    pub defaults: Settings,
    /// Server first, so a client can be pointed at a freshly built server.
    pub sides: Vec<SideConfig>,
}

impl Project {
    pub fn side(&self, side: Side) -> Option<&SideConfig> {
        self.sides.iter().find(|config| config.side == side)
    }

    /// The side whose folders contain a file, if any.
    pub fn side_of(&self, file: &Path) -> Option<Side> {
        let file = normal(file);
        self.sides.iter().find(|config| config.folders.iter().any(|folder| inside(&file, folder))).map(|config| config.side)
    }

    /// Folders a bundle for `side` must not include.
    pub fn forbidden(&self, side: Side) -> Vec<PathBuf> {
        self.sides.iter().filter(|config| config.side != side).flat_map(|config| config.folders.clone()).collect()
    }
}

pub fn parse_target(value: &str) -> Result<Target> {
    Ok(match value {
        // "linux" names the host target on the Linux toolchain, from Windows (WSL) or Linux
        "host" | "linux" => Target::Host,
        "windows" => Target::Windows,
        "wasm" => Target::Wasm,
        _ => bail!("target must be host (or linux), windows, or wasm"),
    })
}

fn check_keys(object: &Map<String, Value>, allowed: &[&str], context: &str) -> Result<()> {
    for key in object.keys() {
        if !allowed.contains(&key.as_str()) {
            bail!("{context}: unknown key \"{key}\" (expected one of {})", allowed.join(", "));
        }
    }
    Ok(())
}

fn string(object: &Map<String, Value>, key: &str, context: &str) -> Result<Option<String>> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::String(text)) if !text.is_empty() => Ok(Some(text.clone())),
        Some(_) => bail!("{context}: \"{key}\" must be a non-empty string"),
    }
}

fn boolean(object: &Map<String, Value>, key: &str, context: &str) -> Result<Option<bool>> {
    match object.get(key) {
        None => Ok(None),
        Some(Value::Bool(flag)) => Ok(Some(*flag)),
        Some(_) => bail!("{context}: \"{key}\" must be true or false"),
    }
}

fn settings(object: &Map<String, Value>, base: &Path, context: &str) -> Result<Settings> {
    Ok(Settings {
        target: string(object, "target", context)?.map(|value| parse_target(&value)).transpose()
            .with_context(|| format!("{context}: \"target\""))?,
        outdir: string(object, "outDir", context)?.map(|path| tidy(&base.join(path))),
        root: string(object, "root", context)?.map(|path| tidy(&base.join(path))),
        react_compiler: boolean(object, "reactCompiler", context)?,
        native: boolean(object, "native", context)?,
        emit_c: boolean(object, "emitC", context)?,
        console: boolean(object, "console", context)?,
        name: string(object, "name", context)?,
        title: string(object, "title", context)?,
        async_page: boolean(object, "asyncPage", context)?,
        http_origin: string(object, "httpOrigin", context)?,
        server: None,
    })
}

fn folders(base: &Path, value: Option<&Value>, context: &str) -> Result<Vec<PathBuf>> {
    let Some(value) = value else { return Ok(Vec::new()) };
    let Value::Array(items) = value else { bail!("{context} must be an array of folder paths") };
    let mut result = Vec::new();
    for item in items {
        let Value::String(text) = item else { bail!("{context} must contain folder paths") };
        let folder = tidy(&base.join(text));
        if !folder.is_dir() {
            bail!("{context}: folder not found: {}", folder.display());
        }
        result.push(folder);
    }
    Ok(result)
}

/// Resolves `.` and `..` segments without touching the filesystem.
fn tidy(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => { result.pop(); }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

/// Drops the `\\?\` prefix Windows `canonicalize` adds to drive paths; the
/// bundler and the C toolchain expect ordinary paths.
fn plain(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path,
    }
}

/// A comparable spelling of a path: absolute, forward slashes, and on Windows
/// case-insensitive, matching the module IDs the bundler reports.
pub fn normal(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let text = resolved.to_string_lossy();
    let text = text.trim_start_matches(r"\\?\").replace('\\', "/");
    let text = text.trim_end_matches('/').to_owned();
    if cfg!(windows) { text.to_lowercase() } else { text }
}

/// Whether a module ID or normalised path lies inside `folder`.
pub fn inside(file: &str, folder: &Path) -> bool {
    let file = file.replace('\\', "/");
    let file = if cfg!(windows) { file.to_lowercase() } else { file };
    file.starts_with(&(normal(folder) + "/"))
}

fn overlaps(left: &Path, right: &Path) -> bool {
    normal(left) == normal(right) || inside(&normal(left), right) || inside(&normal(right), left)
}

pub fn load(path: &Path) -> Result<Project> {
    let text = std::fs::read_to_string(path).with_context(|| format!("cannot read {}", path.display()))?;
    let Value::Object(top) = serde_json::from_str(&text).with_context(|| format!("{} is not valid JSON", path.display()))? else {
        bail!("{} must contain a JSON object", path.display());
    };
    let parent = path.parent().filter(|parent| !parent.as_os_str().is_empty()).map(Path::to_path_buf);
    let base = plain(std::fs::canonicalize(parent.unwrap_or(std::env::current_dir()?))?);
    let file = path.display().to_string();
    let mut allowed = OPTION_KEYS.to_vec();
    allowed.extend(["shared", "server", "client"]);
    check_keys(&top, &allowed, &file)?;
    let defaults = settings(&top, &base, &file)?;
    let shared = folders(&base, top.get("shared"), &format!("{file}: \"shared\""))?;
    let mut sides = Vec::new();
    for side in [Side::Server, Side::Client] {
        let key = side.label();
        let Some(value) = top.get(key) else { continue };
        let Value::Object(section) = value else { bail!("{file}: \"{key}\" must be an object") };
        let context = format!("{file}: \"{key}\"");
        let mut allowed = OPTION_KEYS.to_vec();
        allowed.extend(["folders", "entry"]);
        check_keys(section, &allowed, &context)?;
        if side == Side::Server {
            if let Some(key) = CLIENT_ONLY.iter().find(|key| section.contains_key(**key)) {
                bail!("{context}: \"{key}\" applies to client builds");
            }
        }
        let side_folders = folders(&base, section.get("folders"), &format!("{context}.folders"))?;
        if side_folders.is_empty() { bail!("{context}: \"folders\" must list at least one folder"); }
        let entry = string(section, "entry", &context)?.map(|entry| tidy(&base.join(entry)));
        if let Some(entry) = &entry {
            if !entry.is_file() { bail!("{context}: entry not found: {}", entry.display()); }
            if !side_folders.iter().any(|folder| inside(&normal(entry), folder)) {
                bail!("{context}: the entry must sit inside one of its folders");
            }
        }
        let mut side_settings = settings(section, &base, &context)?;
        side_settings.server = Some(side == Side::Server);
        sides.push(SideConfig { side, folders: side_folders, entry, settings: side_settings });
    }
    if let [server, client] = sides.as_slice() {
        for folder in &server.folders {
            if client.folders.iter().any(|other| overlaps(folder, other)) {
                bail!("{file}: folder {} belongs to both server and client", folder.display());
            }
        }
    }
    for config in &sides {
        for folder in &config.folders {
            if shared.iter().any(|share| overlaps(folder, share)) {
                bail!("{file}: folder {} is both {} and shared", folder.display(), config.side.label());
            }
        }
    }
    Ok(Project { path: path.to_path_buf(), defaults, sides })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str, files: &[&str], config: &str) -> (PathBuf, Result<Project>) {
        let dir = std::env::temp_dir().join(format!("reactc-config-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for file in files {
            let path = dir.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        let config_path = dir.join(FILE_NAME);
        std::fs::write(&config_path, config).unwrap();
        let loaded = load(&config_path);
        (dir, loaded)
    }

    #[test]
    fn layers_options_and_classifies_files_by_folder() {
        let (dir, loaded) = project("layers", &["api/index.ts", "api/routes/notes.ts", "web/App.tsx", "common/types.ts"], r#"{
            "target": "windows", "outDir": "out", "name": "Everything", "shared": ["common"],
            "server": {"folders": ["api"], "entry": "api/index.ts", "name": "Api"},
            "client": {"folders": ["web"], "entry": "web/App.tsx", "httpOrigin": "http://127.0.0.1:5000"}
        }"#);
        let project = loaded.unwrap();
        let server = project.side(Side::Server).unwrap().settings.clone().over(&project.defaults);
        let client = project.side(Side::Client).unwrap().settings.clone().over(&project.defaults);
        assert_eq!((server.name.as_deref(), client.name.as_deref()), (Some("Api"), Some("Everything")));
        assert_eq!(server.target, Some(Target::Windows));
        assert_eq!(server.server, Some(true));
        assert_eq!(project.side_of(&dir.join("api/routes/notes.ts")), Some(Side::Server));
        assert_eq!(project.side_of(&dir.join("common/types.ts")), None);
        let forbidden = project.forbidden(Side::Client);
        assert!(inside(&normal(&dir.join("api/index.ts")), &forbidden[0]));
        assert!(!inside(&normal(&dir.join("common/types.ts")), &forbidden[0]));
        assert_eq!(project.defaults.outdir, Some(plain(std::fs::canonicalize(&dir).unwrap()).join("out")));
    }

    #[test]
    fn rejects_unknown_keys_overlaps_and_misplaced_options() {
        let (_, unknown) = project("unknown", &["a/x.ts"], r#"{"server": {"folders": ["a"], "port": 1}}"#);
        assert!(unknown.err().unwrap().to_string().contains("unknown key \"port\""));
        let (_, overlap) = project("overlap", &["a/x.ts", "a/b/App.tsx"],
            r#"{"server": {"folders": ["a"]}, "client": {"folders": ["a/b"]}}"#);
        assert!(overlap.err().unwrap().to_string().contains("belongs to both"));
        let (_, outside) = project("outside", &["a/x.ts", "b/y.ts"], r#"{"server": {"folders": ["a"], "entry": "b/y.ts"}}"#);
        assert!(outside.err().unwrap().to_string().contains("must sit inside"));
        let (_, title) = project("title", &["a/x.ts"], r#"{"server": {"folders": ["a"], "title": "No"}}"#);
        assert!(title.err().unwrap().to_string().contains("applies to client builds"));
        let (_, target) = project("target", &["a/x.ts"], r#"{"target": "mac", "server": {"folders": ["a"]}}"#);
        assert!(format!("{:#}", target.err().unwrap()).contains("target must be"));
    }
}
