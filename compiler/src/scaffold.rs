//! `reactc new <folder>`: start a project from one of reactc's templates.
//!
//! Templates are folders in `<reactc root>/templates`. The copy's
//! `reactc.config.json` "root" points at the reactc that created it, so its
//! build scripts use the same compiler; `package.json` takes the folder name.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use serde_json::Value;

pub const DEFAULT_TEMPLATE: &str = "node-react-app";
const SKIPPED: &[&str] = &["dist", "node_modules", "data", "__pycache__"];

pub fn templates(root: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(root.join("templates")).into_iter().flatten().flatten()
        .filter(|entry| entry.path().join("reactc.config.json").is_file())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect();
    names.sort();
    names
}

fn copy_tree(from: &Path, to: &Path) -> Result<usize> {
    std::fs::create_dir_all(to)?;
    let mut count = 0;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name();
        if SKIPPED.iter().any(|skipped| name == *skipped) { continue; }
        let target = to.join(&name);
        if entry.file_type()?.is_dir() {
            count += copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).with_context(|| format!("cannot copy {}", entry.path().display()))?;
            count += 1;
        }
    }
    Ok(count)
}

fn edit_json(path: &Path, edit: impl FnOnce(&mut serde_json::Map<String, Value>)) -> Result<()> {
    let mut value: Value = serde_json::from_str(&std::fs::read_to_string(path)?)
        .with_context(|| format!("{} is not valid JSON", path.display()))?;
    let Value::Object(object) = &mut value else { bail!("{} must contain a JSON object", path.display()) };
    edit(object);
    std::fs::write(path, serde_json::to_string_pretty(&value)? + "\n")?;
    Ok(())
}

/// A package name from a folder name: lower case, letters, digits, `.`, `_`, `-`.
fn package_name(folder: &Path) -> String {
    let raw = folder.file_name().and_then(|name| name.to_str()).unwrap_or("my-app").to_lowercase();
    let mut name = String::new();
    for character in raw.chars() {
        let keep = character.is_ascii_alphanumeric() || "._-".contains(character);
        if keep { name.push(character); } else if !name.ends_with('-') { name.push('-'); }
    }
    let name = name.trim_matches(|c| "._-".contains(c)).to_owned();
    if name.is_empty() { "my-app".into() } else { name }
}

pub fn create(root: &Path, target: &Path, template: &str) -> Result<PathBuf> {
    let source = root.join("templates").join(template);
    if !source.join("reactc.config.json").is_file() {
        bail!("unknown template \"{template}\"; available: {}", templates(root).join(", "));
    }
    if target.exists() && std::fs::read_dir(target)?.next().is_some() {
        bail!("{} already exists and is not empty", target.display());
    }
    let files = copy_tree(&source, target)?;
    let root_text = root.to_string_lossy().trim_start_matches(r"\\?\").replace('\\', "/");
    edit_json(&target.join("reactc.config.json"), |config| {
        config.insert("root".into(), Value::String(root_text));
    })?;
    let manifest = target.join("package.json");
    if manifest.is_file() {
        let name = package_name(target);
        let root_text = root.to_string_lossy().trim_start_matches(r"\\?\").replace('\\', "/");
        edit_json(&manifest, |package| {
            package.insert("name".into(), Value::String(name));
            // The template's libraries (file:../../packages/...) are this reactc's.
            for section in ["dependencies", "devDependencies"] {
                if let Some(Value::Object(dependencies)) = package.get_mut(section) {
                    for value in dependencies.values_mut() {
                        if let Some(rest) = value.as_str().and_then(|text| text.strip_prefix("file:../../")) {
                            *value = Value::String(format!("file:{root_text}/{rest}"));
                        }
                    }
                }
            }
        })?;
    }
    println!("Created {} from the {template} template ({files} files).", target.display());
    Ok(target.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_packages_after_their_folder() {
        assert_eq!(package_name(Path::new("C:/apps/My Cool App!")), "my-cool-app");
        assert_eq!(package_name(Path::new("/tmp/...")), "my-app");
    }

    #[test]
    fn copies_a_template_and_points_it_at_this_reactc() {
        let base = std::env::temp_dir().join(format!("reactc-scaffold-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let template = base.join("root/templates/demo");
        std::fs::create_dir_all(template.join("dist")).unwrap();
        std::fs::create_dir_all(template.join("client")).unwrap();
        std::fs::write(template.join("reactc.config.json"), r#"{"root": "../..", "target": "windows"}"#).unwrap();
        std::fs::write(template.join("package.json"), r#"{"name": "demo", "private": true, "dependencies": {"@reactc/threads": "file:../../packages/reactc-threads", "left-pad": "^1.0.0"}}"#).unwrap();
        std::fs::write(template.join("client/App.tsx"), "export default () => null;").unwrap();
        std::fs::write(template.join("dist/old.exe"), "").unwrap();
        let root = base.join("root");
        assert_eq!(templates(&root), ["demo"]);
        let target = base.join("Shiny App");
        create(&root, &target, "demo").unwrap();
        let config: Value = serde_json::from_str(&std::fs::read_to_string(target.join("reactc.config.json")).unwrap()).unwrap();
        assert_eq!(config["root"], root.to_string_lossy().replace('\\', "/"));
        assert_eq!(config["target"], "windows");
        let package: Value = serde_json::from_str(&std::fs::read_to_string(target.join("package.json")).unwrap()).unwrap();
        let root_text = root.to_string_lossy().replace('\\', "/");
        assert_eq!(package["dependencies"]["@reactc/threads"], format!("file:{root_text}/packages/reactc-threads"));
        assert_eq!(package["dependencies"]["left-pad"], "^1.0.0");
        let package: Value = serde_json::from_str(&std::fs::read_to_string(target.join("package.json")).unwrap()).unwrap();
        assert_eq!(package["name"], "shiny-app");
        assert!(target.join("client/App.tsx").is_file() && !target.join("dist").exists());
        assert!(create(&root, &target, "demo").unwrap_err().to_string().contains("not empty"));
        assert!(create(&root, &base.join("other"), "missing").unwrap_err().to_string().contains("available: demo"));
    }
}
