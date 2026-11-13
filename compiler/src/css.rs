//! Compile imported CSS into the native renderer's supported style rules.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use anyhow::{Result, anyhow};
use lightningcss::{
    rules::{CssRule, CssRuleList},
    stylesheet::{ParserOptions, PrinterOptions, StyleSheet},
    traits::ToCss,
};
use regex::Regex;
use serde_json::{Value, json};

static PART: LazyLock<Regex> = LazyLock::new(|| Regex::new(
    r#"^(?:(\*)|([A-Za-z][\w-]*)|([.#])([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\]|(:root)|:(hover|focus)\b)"#,
).unwrap());
static WIDTH: LazyLock<Regex> = LazyLock::new(|| Regex::new(
    r"^\(\s*(?:(min|max)-width:\s*|width\s*(<=|>=)\s*)(\d+(?:\.\d+)?)px\s*\)$",
).unwrap());

fn selector(source: &str) -> Option<Vec<Value>> {
    let mut parts = Vec::new();
    let mut rest = source.trim();
    let mut direct = false;
    while !rest.is_empty() {
        let mut part = serde_json::Map::new();
        let mut classes = Vec::new();
        let mut attributes = Vec::new();
        let mut states = Vec::new();
        part.insert("direct".into(), json!(direct));
        let original = rest;
        while let Some(token) = PART.captures(rest) {
            let group = |index| token.get(index).map(|value| value.as_str());
            if let Some(tag) = group(2) {
                if rest != original { return None; }
                part.insert("tag".into(), json!(tag.to_ascii_lowercase()));
            }
            if group(1).is_some() && rest != original { return None; }
            if let Some(marker) = group(3) {
                let name = group(4)?;
                if marker == "." { classes.push(name); }
                else { part.insert("id".into(), json!(name)); }
            }
            if let Some(name) = group(5) {
                attributes.push((name, group(6).or_else(|| group(7)).or_else(|| group(8))));
            }
            if group(9).is_some() { part.insert("root".into(), json!(true)); }
            // Interaction states are resolved by the page runtime from host
            // pointer and focus reports.
            if let Some(state) = group(10) { states.push(state); }
            rest = &rest[token.get(0)?.end()..];
        }
        if rest == original { return None; }
        part.insert("classes".into(), json!(classes));
        part.insert("attributes".into(), json!(attributes));
        if !states.is_empty() { part.insert("states".into(), json!(states)); }
        parts.push(Value::Object(part));
        let trimmed = rest.trim_start();
        direct = trimmed.starts_with('>');
        if direct {
            rest = trimmed[1..].trim_start();
            if rest.is_empty() { return None; }
        } else if trimmed.len() < rest.len() || trimmed.is_empty() {
            rest = trimmed;
        } else {
            return None;
        }
    }
    Some(parts)
}

/// Properties whose renderer support depends on the value. Unsupported
/// values are reported like unsupported properties.
fn supported_value(name: &str, value: &str) -> bool {
    match name {
        // The native renderer sizes explicit widths as border boxes.
        "box-sizing" => value == "border-box",
        "cursor" => matches!(value, "pointer" | "default" | "auto"),
        "font-style" => matches!(value, "italic" | "normal"),
        _ => true,
    }
}

fn supported(name: &str) -> bool {
    name.starts_with("--") || matches!(name,
        "align-items" | "align-self" | "background" | "background-color" |
        "border" | "border-top" | "border-bottom" | "border-left" | "border-right" |
        "border-color" | "border-width" | "border-top-width" | "border-bottom-width" |
        "border-left-width" | "border-right-width" | "border-radius" | "box-sizing" | "cursor" |
        "font-style" | "opacity" |
        "bottom" | "color" | "column-gap" | "display" | "flex" | "flex-basis" |
        "flex-direction" | "flex-grow" | "flex-shrink" | "flex-wrap" | "font-family" |
        "font-size" | "font-weight" | "gap" | "height" | "justify-content" |
        "left" | "line-height" | "margin" | "margin-top" | "margin-right" |
        "margin-bottom" | "margin-left" | "max-height" | "max-width" | "min-height" |
        "min-width" | "overflow" | "overflow-y" | "padding" | "padding-top" |
        "padding-right" | "padding-bottom" | "padding-left" | "position" | "right" |
        "row-gap" | "text-align" | "top" | "width" | "z-index")
}

fn rules(
    input: &CssRuleList<'_>, min: f64, max: f64, output: &mut Vec<Value>,
    warnings: &mut BTreeSet<String>,
) -> Result<()> {
    for rule in &input.0 {
        match rule {
            CssRule::Style(style) => {
                let mut declarations = Vec::new();
                for (important, list) in [
                    (false, &style.declarations.declarations),
                    (true, &style.declarations.important_declarations),
                ] {
                    for declaration in list {
                        let id = declaration.property_id();
                        let name = id.name();
                        if !supported(name) {
                            warnings.insert(format!("property {name}"));
                            continue;
                        }
                        let value = declaration.value_to_css_string(PrinterOptions::default())?;
                        if !name.starts_with("--") && !value.contains("var(") && !supported_value(name, &value) {
                            warnings.insert(format!("property {name}: {value}"));
                            continue;
                        }
                        declarations.push(json!([name, value, important]));
                    }
                }
                if declarations.is_empty() { continue; }
                for entry in &style.selectors.0 {
                    let text = entry.to_css_string(PrinterOptions::default())?;
                    match selector(&text) {
                        Some(parts) => output.push(json!({
                            "parts": parts, "specificity": entry.specificity(),
                            "min": min, "max": max, "declarations": declarations,
                        })),
                        None => { warnings.insert(format!("selector {text}")); }
                    }
                }
                if !style.rules.0.is_empty() { warnings.insert("nested style rules".into()); }
            }
            CssRule::Media(media) => {
                let condition = media.query.to_css_string(PrinterOptions::default())?;
                if let Some(matched) = WIDTH.captures(&condition) {
                    let width: f64 = matched[3].parse()?;
                    let lower_bound = matched.get(1).is_some_and(|value| value.as_str() == "min") ||
                        matched.get(2).is_some_and(|value| value.as_str() == ">=");
                    if lower_bound { rules(&media.rules, min.max(width), max, output, warnings)?; }
                    else { rules(&media.rules, min, max.min(width), output, warnings)?; }
                } else {
                    warnings.insert(format!("@media {condition}"));
                }
            }
            CssRule::Ignored => {}
            _ => {
                let text = rule.to_css_string(PrinterOptions { minify: true, ..Default::default() })?;
                let keyword = text.split(|ch: char| ch.is_whitespace() || ch == '{' || ch == ';').next().unwrap_or("");
                warnings.insert(format!("rule {keyword}"));
            }
        }
    }
    Ok(())
}

pub fn compile(source: &str, filename: &str) -> Result<(Vec<Value>, BTreeSet<String>)> {
    let sheet = StyleSheet::parse(source, ParserOptions { filename: filename.into(), ..Default::default() })
        .map_err(|error| anyhow!("{filename}: {error}"))?;
    let mut output = Vec::new();
    let mut warnings = BTreeSet::new();
    rules(&sheet.rules, 0., f64::MAX, &mut output, &mut warnings)?;
    Ok((output, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_cascade_order_and_resolves_selector_structure() {
        let (rules, warnings) = compile(
            r#":root { --ink: #222; } .page > [data-mode="dark"].panel { color: var(--ink) !important; }
                @media (max-width: 768px) { .panel { padding: 12px; } } .panel:active { color: red; }"#,
            "test.css",
        ).unwrap();
        assert_eq!(rules.len(), 3, "{warnings:?}");
        assert_eq!(rules[1]["parts"][1]["direct"], true);
        assert_eq!(rules[1]["parts"][1]["attributes"][0][1], "dark");
        assert_eq!(rules[1]["declarations"][0][2], true);
        assert_eq!(rules[2]["max"], 768.);
        assert!(warnings.contains("selector .panel:active"));
    }

    #[test]
    fn compiles_interaction_states_and_reports_unsupported_values() {
        let (rules, warnings) = compile(
            r#".item:hover .remove { opacity: 1; } .field:focus { border-color: green; }
                .field:focus-visible { color: red; } .a { box-sizing: content-box; cursor: grab; }
                .b { box-sizing: border-box; border-right: 1px solid red; font-style: italic; }"#,
            "test.css",
        ).unwrap();
        assert_eq!(rules.len(), 3, "{warnings:?}");
        assert_eq!(rules[0]["parts"][0]["states"][0], "hover");
        assert!(rules[0]["parts"][1].get("states").is_none());
        assert_eq!(rules[1]["parts"][0]["states"][0], "focus");
        assert!(warnings.contains("selector .field:focus-visible"), "{warnings:?}");
        assert!(warnings.contains("property box-sizing: content-box"), "{warnings:?}");
        assert!(warnings.contains("property cursor: grab"), "{warnings:?}");
    }
}
