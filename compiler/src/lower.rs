//! Per-module lowering: React Compiler, then TypeScript and JSX removal.

use std::path::Path;

use anyhow::{Result, bail};
use oxc::allocator::Allocator;
use oxc::ast::ast::{JSXElement, JSXFragment};
use oxc::ast_visit::Visit;
use oxc::codegen::Codegen;
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;
use oxc::transformer::{JsxOptions, JsxRuntime, TransformOptions, Transformer};
use oxc_react_compiler::{CompileResult, PluginOptions, compile};

pub struct Lowered {
    pub code: String,
    /// The React Compiler rewrote at least one component or hook in this module.
    pub memoised: bool,
}

/// JSX becomes calls to the native runtime's element factory, not React's.
pub const JSX_FACTORY: &str = "__jsx";
pub const JSX_FRAGMENT: &str = "__Fragment";

#[derive(Default)]
struct JsxPresence(bool);

impl<'a> Visit<'a> for JsxPresence {
    fn visit_jsx_element(&mut self, _: &JSXElement<'a>) { self.0 = true; }
    fn visit_jsx_fragment(&mut self, _: &JSXFragment<'a>) { self.0 = true; }
}

pub fn lower(path: &Path, source: &str, react_compiler: bool) -> Result<Option<Lowered>> {
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::tsx());
    let plain_js = path.extension().is_some_and(|extension| extension == "js");
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, if plain_js { source_type.with_jsx(true) } else { source_type }).parse();
    if plain_js && parsed.diagnostics.is_empty() {
        let mut jsx = JsxPresence::default();
        jsx.visit_program(&parsed.program);
        if !jsx.0 { return Ok(None); }
    }
    if !parsed.diagnostics.is_empty() {
        let messages: Vec<String> = parsed.diagnostics.iter().map(|error| format!("{error}")).collect();
        bail!("{}: syntax error: {}", path.display(), messages.join("; "));
    }
    let mut program = parsed.program;

    let mut memoised = false;
    if react_compiler {
        // Must see the pristine AST, before types and JSX are removed.
        let result = {
            let semantic = SemanticBuilder::new().with_build_nodes(true).build(&program).semantic;
            compile(&program, &semantic, &allocator, PluginOptions::default())
        };
        match result {
            CompileResult::Success { output, diagnostics } => {
                // A component the compiler cannot prove safe is left as written.
                for diagnostic in &diagnostics {
                    eprintln!("react-compiler: {}: {diagnostic}", path.display());
                }
                if let Some(output) = output {
                    output.transform(&mut program);
                    memoised = true;
                }
            }
            CompileResult::Fatal { diagnostics } => {
                let messages: Vec<String> = diagnostics.iter().map(|d| format!("{d}")).collect();
                bail!("{}: React Compiler: {}", path.display(), messages.join("; "));
            }
        }
    }

    let scoping = SemanticBuilder::new().build(&program).semantic.into_scoping();
    let options = TransformOptions {
        jsx: JsxOptions {
            runtime: JsxRuntime::Classic,
            pragma: Some(JSX_FACTORY.into()),
            pragma_frag: Some(JSX_FRAGMENT.into()),
            ..JsxOptions::default()
        },
        ..TransformOptions::default()
    };
    let transformed = Transformer::new(&allocator, path, &options).build_with_scoping(scoping, &mut program);
    if !transformed.diagnostics.is_empty() {
        let messages: Vec<String> = transformed.diagnostics.iter().map(|error| format!("{error}")).collect();
        bail!("{}: {}", path.display(), messages.join("; "));
    }
    Ok(Some(Lowered { code: Codegen::new().build(&program).code, memoised }))
}

/// A thread entry found in a module: the span of the call's first argument
/// and the literal module path it names.
pub struct ThreadEntry {
    pub start: usize,
    pub end: usize,
    pub specifier: String,
}

#[derive(Default)]
struct ThreadEntries(Vec<ThreadEntry>);

fn literal_path(argument: &oxc::ast::ast::Argument<'_>) -> Option<String> {
    use oxc::ast::ast::{Argument, Expression};
    let text = match argument {
        Argument::StringLiteral(literal) => literal.value.to_string(),
        Argument::TemplateLiteral(template) if template.expressions.is_empty() && template.quasis.len() == 1 => {
            template.quasis[0].value.cooked.as_ref()?.to_string()
        }
        // new URL('./worker.js', import.meta.url)
        Argument::NewExpression(url) => {
            let Expression::Identifier(callee) = &url.callee else { return None };
            if callee.name != "URL" || url.arguments.len() != 2 { return None; }
            let Argument::StringLiteral(literal) = &url.arguments[0] else { return None };
            let Argument::StaticMemberExpression(base) = &url.arguments[1] else { return None };
            if base.property.name != "url" || !matches!(&base.object, Expression::ImportMeta(_)) { return None; }
            literal.value.to_string()
        }
        _ => return None,
    };
    (text.starts_with("./") || text.starts_with("../")).then_some(text)
}

fn callee_named(callee: &oxc::ast::ast::Expression<'_>, name: &str) -> bool {
    use oxc::ast::ast::Expression;
    match callee {
        Expression::Identifier(identifier) => identifier.name == name,
        Expression::StaticMemberExpression(member) => member.property.name == name,
        _ => false,
    }
}

impl<'a> Visit<'a> for ThreadEntries {
    fn visit_new_expression(&mut self, it: &oxc::ast::ast::NewExpression<'a>) {
        use oxc::span::GetSpan;
        if callee_named(&it.callee, "Worker") {
            if let Some(first) = it.arguments.first() {
                if let Some(specifier) = literal_path(first) {
                    let span = first.span();
                    self.0.push(ThreadEntry { start: span.start as usize, end: span.end as usize, specifier });
                }
            }
        }
        oxc::ast_visit::walk::walk_new_expression(self, it);
    }
    fn visit_call_expression(&mut self, it: &oxc::ast::ast::CallExpression<'a>) {
        use oxc::span::GetSpan;
        if callee_named(&it.callee, "fork") {
            if let Some(first) = it.arguments.first() {
                if let Some(specifier) = literal_path(first) {
                    let span = first.span();
                    self.0.push(ThreadEntry { start: span.start as usize, end: span.end as usize, specifier });
                }
            }
        }
        oxc::ast_visit::walk::walk_call_expression(self, it);
    }
}

/// Literal worker and fork entries in a server module, in source order.
pub fn find_thread_entries(path: &Path, source: &str) -> Vec<ThreadEntry> {
    if !source.contains("Worker") && !source.contains("fork") { return Vec::new(); }
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::mjs());
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() { return Vec::new(); }
    let mut found = ThreadEntries::default();
    found.visit_program(&parsed.program);
    found.0.sort_by_key(|entry| entry.start);
    found.0
}

/// Finds `await` outside any function: top-level await.
#[derive(Default)]
struct TopLevelAwait(bool);

impl<'a> Visit<'a> for TopLevelAwait {
    fn visit_await_expression(&mut self, _: &oxc::ast::ast::AwaitExpression<'a>) { self.0 = true; }
    fn visit_for_of_statement(&mut self, it: &oxc::ast::ast::ForOfStatement<'a>) {
        if it.r#await { self.0 = true; }
        oxc::ast_visit::walk::walk_for_of_statement(self, it);
    }
    // Await inside these belongs to the function, not the module.
    fn visit_function(&mut self, _: &oxc::ast::ast::Function<'a>, _: oxc::syntax::scope::ScopeFlags) {}
    fn visit_arrow_function_expression(&mut self, _: &oxc::ast::ast::ArrowFunctionExpression<'a>) {}
    fn visit_static_block(&mut self, _: &oxc::ast::ast::StaticBlock<'a>) {}
}

/// Server entries are bundled as CommonJS, which has no top-level await.
/// When the entry module awaits at the top level, its imports stay first and
/// the rest of the module body runs in an async function. A rejection is
/// reported and sets the exit code, as Node does for the module.
pub fn wrap_top_level_await(path: &Path, source: &str) -> Result<Option<String>> {
    use oxc::ast::ast::ModuleDeclaration;
    use oxc::span::GetSpan;
    // Server entries are ES modules; `.js` would otherwise be guessed from its content.
    let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::mjs()).with_module(true);
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() { return Ok(None); }
    let mut found = TopLevelAwait::default();
    found.visit_program(&parsed.program);
    if !found.0 { return Ok(None); }
    let mut imports = String::new();
    let mut body = String::new();
    let mut cursor = 0usize;
    for statement in &parsed.program.body {
        let span = statement.span();
        let (start, end) = (span.start as usize, span.end as usize);
        // Keep comments and blank lines between statements with the statement after them.
        let text = &source[cursor..end];
        cursor = end;
        match statement.as_module_declaration() {
            Some(ModuleDeclaration::ImportDeclaration(_)) => { imports.push_str(text); imports.push('\n'); }
            Some(_) => {
                bail!("{}: a server entry with top-level await cannot also export (at byte {start})", path.display());
            }
            None => { body.push_str(text); body.push('\n'); }
        }
    }
    body.push_str(&source[cursor..]);
    let directives: String = parsed.program.directives.iter()
        .map(|directive| format!("{}\n", &source[directive.span.start as usize..directive.span.end as usize]))
        .collect();
    Ok(Some(format!(
        "{directives}{imports}(async () => {{\n{body}\n}})().catch((error) => {{ console.error(error); process.exitCode = 1; }});\n"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wraps_top_level_await_after_the_imports() {
        let source = "import fs from 'node:fs';\n// load\nconst text = await fs.promises.readFile('x');\nfor await (const line of lines()) {}\nasync function lines() { await 1; }\n";
        let wrapped = wrap_top_level_await(Path::new("server.js"), source).unwrap().unwrap();
        assert!(wrapped.starts_with("import fs from 'node:fs';"));
        assert!(wrapped.contains("(async () => {\n\n// load\nconst text = await"));
        assert!(wrapped.trim_end().ends_with("process.exitCode = 1; });"));
        let allocator = Allocator::default();
        let reparsed = Parser::new(&allocator, &wrapped, SourceType::mjs()).parse();
        assert!(reparsed.diagnostics.is_empty(), "{wrapped}");
    }

    #[test]
    fn leaves_modules_without_top_level_await_alone() {
        let source = "import x from 'y';\nasync function f() { await x; }\nconst g = async () => { for await (const a of b) {} };\n";
        assert!(wrap_top_level_await(Path::new("server.js"), source).unwrap().is_none());
        let typed = "import type { A } from './a.ts';\nconst a: A = await load();\n";
        assert!(wrap_top_level_await(Path::new("server.ts"), typed).unwrap().unwrap().contains("const a: A = await load();"));
        let exported = wrap_top_level_await(Path::new("server.js"), "await 1;\nexport const a = 1;\n");
        assert!(exported.is_err(), "{exported:?}");
    }
}

#[cfg(test)]
mod thread_tests {
    use super::*;

    #[test]
    fn finds_literal_worker_and_fork_entries() {
        let source = "import { Worker } from 'node:worker_threads';\nimport cp from 'node:child_process';\n\
            const a = new Worker('./a.js', { workerData: 1 });\nconst b = new Worker(new URL('./b.ts', import.meta.url));\n\
            const c = cp.fork(`./c.js`, ['x']);\nconst d = new Worker(name);\nconst e = new Worker('pkg/worker');\n";
        let entries = find_thread_entries(Path::new("server.js"), source);
        let names: Vec<&str> = entries.iter().map(|entry| entry.specifier.as_str()).collect();
        assert_eq!(names, ["./a.js", "./b.ts", "./c.js"]);
        assert_eq!(&source[entries[0].start..entries[0].end], "'./a.js'");
        assert_eq!(&source[entries[1].start..entries[1].end], "new URL('./b.ts', import.meta.url)");
    }
}

#[cfg(test)]
mod lowering_tests {
    use super::*;

    #[test]
    fn lowers_jsx_in_a_js_module() {
        let source = "export default function App() { return <><p>Ready</p></>; }";
        let lowered = lower(Path::new("app.js"), source, false).unwrap().unwrap();
        assert!(lowered.code.contains(JSX_FACTORY));
        assert!(lowered.code.contains(JSX_FRAGMENT));
    }

    #[test]
    fn leaves_non_jsx_javascript_unchanged() {
        let source = "export const text = '<main />';";
        assert!(lower(Path::new("text.js"), source, false).unwrap().is_none());
    }
}
