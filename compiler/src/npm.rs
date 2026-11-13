//! Ahead-of-time alternatives for npm dependencies that generate code at runtime.

use std::path::Path;

use anyhow::{Result, bail};
use regex::{NoExpand, Regex};

pub fn lower(path: &Path, source: &str) -> Result<Option<String>> {
    let path = path.to_string_lossy().replace('\\', "/");
    if path.ends_with("/node_modules/pg/lib/crypto/utils.js") && source.contains("subtleCrypto.importKey('raw'") {
        // Node's OpenSSL functions provide the same SCRAM primitives, including
        // PBKDF2 key import and derivation which Porffor's WebCrypto lacks.
        return Ok(Some(include_str!("../../src/pg-crypto.cjs").to_owned()));
    }
    let mut edits = Vec::new();
    if path.ends_with("/node_modules/zod/v4/core/util.js") {
        let probe = Regex::new(r"(?ms)^export const allowsEval = /\* @__PURE__\*/\s*cached\(\(\) => \{.*?^\}\);")?;
        if probe.is_match(source) {
            return Ok(Some(probe.replace(source, "export const allowsEval = () => false;").into_owned()));
        }
    } else if path.ends_with("/node_modules/find-my-way/lib/node.js") {
        edits.push(("_compilePrefixMatch", r#"    const prefix = this.prefix
    this.matchPrefix = (path, offset) => path.startsWith(prefix.slice(1), offset + 1)"#));
    } else if path.ends_with("/node_modules/find-my-way/lib/handler-storage.js") {
        edits.push(("_compileCreateParamsObject", r#"    return values => {
      const result = new NullObject()
      for (let i = 0; i < params.length; i++) result[params[i]] = values[i]
      return result
    }"#));
        edits.push(("_compileGetHandlerMatchingConstraints", r#"    this.constrainedHandlerStores = {}
    for (const key of this.constraints) {
      const store = constrainer.newStoreForConstraint(key)
      this.constrainedHandlerStores[key] = store
      this._buildConstraintStore(store, key)
    }
    this._getHandlerMatchingConstraints = derived => {
      let candidates = (1 << this.handlers.length) - 1
      for (const key of this.constraints) {
        const mask = this._constrainedIndexBitmask(key)
        const value = derived[key]
        if (value === undefined) candidates &= mask
        else {
          const matches = this.constrainedHandlerStores[key].get(value) || 0
          candidates &= constrainer.strategies[key].mustMatchWhenDerived ? matches : (matches | mask)
        }
        if (candidates === 0) return null
      }
      for (const key of Object.keys(constrainer.strategies)) {
        if (constrainer.strategies[key].mustMatchWhenDerived &&
            !this.constraints.includes(key) && derived[key] !== undefined) return null
      }
      return this.handlers[31 - Math.clz32(candidates)]
    }"#));
    } else if path.ends_with("/node_modules/find-my-way/lib/constrainer.js") {
        edits.push(("_buildDeriveConstraints", r#"    if (this.strategiesInUse.size === 0) return
    this.deriveSyncConstraints = (req, ctx) => {
      const values = {}
      for (const key of this.strategiesInUse) {
        const strategy = this.strategies[key]
        if (strategy.isCustom) values[strategy.name] = strategy.deriveConstraint(req, ctx)
        else if (key === 'version') values.version = req.headers['accept-version']
        else values.host = req.headers.host || req.headers[':authority']
      }
      return values
    }"#));
    }
    if edits.is_empty() || !source.contains("new Function(") { return Ok(None); }
    let mut output = source.to_owned();
    for (name, body) in edits {
        let method = Regex::new(&format!(r"(?ms)^  ({name} *\([^\n]*\) *\{{)\r?\n(.*?)^  \}}"))?;
        let Some(found) = method.captures(&output) else {
            bail!("unsupported find-my-way implementation in {path}: missing {name}");
        };
        if !found[2].contains("new Function(") {
            bail!("unsupported find-my-way implementation in {path}: unexpected {name}");
        }
        let replacement = format!("  {}\n{body}\n  }}", &found[1]);
        output = method.replace(&output, NoExpand(&replacement)).into_owned();
    }
    Ok(Some(output))
}
