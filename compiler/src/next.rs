//! Next.js App Router page discovery for the native desktop runtime.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::Value;

#[derive(Debug)]
pub struct App {
    root: PathBuf,
}

impl App {
    pub fn discover(entry: &Path) -> Result<Option<Self>> {
        if !entry.file_stem().is_some_and(|name| name == "page") {
            return Ok(None);
        }
        for root in entry.ancestors().skip(1).filter(|path| path.ends_with("app")) {
            let Some(project) = root.parent() else { continue };
            let project = if project.ends_with("src") {
                let Some(parent) = project.parent() else { continue };
                parent
            } else { project };
            let manifest = project.join("package.json");
            if !manifest.is_file() { continue; }
            let manifest: Value = serde_json::from_slice(&std::fs::read(manifest)?)?;
            if manifest["dependencies"]["next"].is_string() || manifest["devDependencies"]["next"].is_string() {
                return Ok(Some(Self { root: root.to_owned() }));
            }
        }
        Ok(None)
    }

    pub fn entry(&self, runtime: &Path, specifier: impl Fn(&Path) -> String) -> Result<String> {
        let mut pages = Vec::new();
        let mut handlers = Vec::new();
        self.entries(&self.root, &mut pages, &mut handlers)?;
        pages.sort();
        handlers.sort();
        let mut imports = format!("import {{ createApp }} from {};\n", specifier(runtime));
        let mut routes = Vec::new();
        let mut endpoints = Vec::new();
        for (index, page) in pages.iter().enumerate() {
            let path = page.parent().unwrap().strip_prefix(&self.root)?;
            let path = format!("/{}", path.to_string_lossy().replace('\\', "/"));
            imports.push_str(&format!("import Page{index} from {};\n", specifier(page)));
            routes.push(format!("[{}, Page{index}]", serde_json::to_string(&path)?));
        }
        for (index, handler) in handlers.iter().enumerate() {
            let path = handler.parent().unwrap().strip_prefix(&self.root)?;
            let path = format!("/{}", path.to_string_lossy().replace('\\', "/"));
            imports.push_str(&format!("import * as Handler{index} from {};\n", specifier(handler)));
            endpoints.push(format!("[{}, Handler{index}]", serde_json::to_string(&path)?));
        }
        if let Some(layout) = ["tsx", "jsx", "ts", "js"].iter()
            .map(|extension| self.root.join(format!("layout.{extension}")))
            .find(|path| path.is_file()) {
            imports.push_str(&format!("import Layout from {};\n", specifier(&layout)));
        } else {
            imports.push_str("const Layout = undefined;\n");
        }
        Ok(format!("{imports}export default createApp([{}], Layout, [{}]);\n", routes.join(","), endpoints.join(",")))
    }

    fn entries(&self, folder: &Path, pages: &mut Vec<PathBuf>, handlers: &mut Vec<PathBuf>) -> Result<()> {
        for item in std::fs::read_dir(folder)? {
            let item = item?;
            let path = item.path();
            let name = item.file_name();
            let name = name.to_string_lossy();
            if item.file_type()?.is_dir() && !name.starts_with(['.', '_', '@', '(']) {
                self.entries(&path, pages, handlers)?;
            } else if matches!(name.as_ref(), "page.tsx" | "page.jsx" | "page.ts" | "page.js") {
                pages.push(path);
            } else if matches!(name.as_ref(), "route.ts" | "route.js") {
                handlers.push(path);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::App;
    use std::fs;

    #[test]
    fn includes_layout_dynamic_pages_and_route_handlers() {
        let root = std::env::temp_dir().join(format!("reactc-next-{}", std::process::id()));
        let app = root.join("src/app");
        fs::create_dir_all(app.join("media/[id]")).unwrap();
        fs::create_dir_all(app.join("api/why")).unwrap();
        fs::write(root.join("package.json"), r#"{"dependencies":{"next":"15"}}"#).unwrap();
        for path in ["page.tsx", "layout.tsx", "media/[id]/page.tsx", "api/why/route.ts"] {
            fs::write(app.join(path), "").unwrap();
        }
        let entry = App::discover(&app.join("page.tsx")).unwrap().unwrap();
        let code = entry.entry(&root.join("next-app.js"), |path| serde_json::to_string(path).unwrap()).unwrap();
        fs::remove_dir_all(root).unwrap();
        assert!(code.contains("[\"/\", Page"));
        assert!(code.contains("[\"/media/[id]\", Page"));
        assert!(code.contains("[\"/api/why\", Handler"));
        assert!(code.contains("import Layout"));
    }
}
