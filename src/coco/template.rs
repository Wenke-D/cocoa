//! Template validation and rendering (convention §6.1).
//!
//! A template's variables and `[render].params` must match **exactly**:
//! an undefined variable is an error, not an empty string, and a declared
//! param the template never uses is equally an error. Both directions are
//! checked when the manifest loads, and the check is repeated at render time.
//!
//! A template is a single self-contained file: `{% include %}`, `{% extends %}`
//! and `{% import %}` (including `{% from ... import %}`) are rejected because
//! they pull in variables from outside the file. Loops, conditionals, filters,
//! and `{% set %}` are fine.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use minijinja::machinery::{WhitespaceConfig, ast, parse};
use minijinja::syntax::SyntaxConfig;
use minijinja::{Environment, UndefinedBehavior};

/// Why a template did not pass validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TemplateError {
    Parse(String),
    /// The template pulls in another file (§6.1).
    Import(String),
    /// Exact-match failure: which variables are undefined and which declared
    /// params are never used.
    Mismatch {
        undefined: Vec<String>,
        unused: Vec<String>,
    },
}

impl std::fmt::Display for TemplateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Parse(message) => write!(f, "does not parse: {message}"),
            Self::Import(statement) => {
                write!(f, "uses `{statement}`, which pulls in another file")
            }
            Self::Mismatch { undefined, unused } => {
                if !undefined.is_empty() {
                    write!(
                        f,
                        "undefined variable{}: {}",
                        plural(undefined.len()),
                        undefined.join(", ")
                    )?;
                }
                if !unused.is_empty() {
                    if !undefined.is_empty() {
                        f.write_str("; ")?;
                    }
                    write!(
                        f,
                        "declared param{} never used: {}",
                        plural(unused.len()),
                        unused.join(", ")
                    )?;
                }
                Ok(())
            }
        }
    }
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}

/// Names the language provides that are not experiment data.
const BUILTINS: [&str; 4] = ["range", "dict", "debug", "namespace"];

/// Validates that a template's variable references are exactly `params`.
pub fn analyze(source: &str, params: &[String]) -> Result<(), TemplateError> {
    let root = parse(
        source,
        "<template>",
        SyntaxConfig,
        WhitespaceConfig::default(),
    )
    .map_err(|e| TemplateError::Parse(e.to_string()))?;

    let mut collector = Collector::new();
    collector.collect_macro_names(&root);
    collector.walk_stmt(&root)?;

    let declared: BTreeSet<&str> = params.iter().map(String::as_str).collect();
    let mut undefined: Vec<String> = collector
        .referenced
        .iter()
        .filter(|name| !declared.contains(**name))
        .map(|name| (*name).to_owned())
        .collect();
    let mut unused: Vec<String> = declared
        .iter()
        .filter(|name| !collector.referenced.contains(**name))
        .map(|name| (*name).to_owned())
        .collect();
    undefined.sort();
    unused.sort();

    if undefined.is_empty() && unused.is_empty() {
        Ok(())
    } else {
        Err(TemplateError::Mismatch { undefined, unused })
    }
}

/// Renders a template with strict undefined-variable behavior.
///
/// The caller re-runs [`analyze`] before rendering, so a template edited
/// between one refresh and the next can never produce a half-rendered
/// submission (§6.1).
pub fn render(source: &str, params: &BTreeMap<String, String>) -> Result<String, TemplateError> {
    let mut env = Environment::new();
    env.set_undefined_behavior(UndefinedBehavior::Strict);
    env.set_auto_escape_callback(|_| minijinja::AutoEscape::None);
    env.render_str(source, params)
        .map_err(|e| TemplateError::Parse(e.to_string()))
}

struct Collector<'s> {
    /// Lexical scopes of names bound inside the template (`for` targets,
    /// `set` targets, `with` bindings, macro parameters, `loop`).
    scopes: Vec<HashSet<&'s str>>,
    /// Top-level names the template reads.
    referenced: BTreeSet<&'s str>,
    /// Names of macros defined in this template; calling them is not a
    /// variable reference.
    macros: HashSet<&'s str>,
}

impl<'s> Collector<'s> {
    fn new() -> Self {
        Self {
            scopes: vec![HashSet::new()],
            referenced: BTreeSet::new(),
            macros: HashSet::new(),
        }
    }

    fn is_local(&self, name: &str) -> bool {
        self.scopes.iter().any(|scope| scope.contains(name))
    }

    fn push(&mut self) {
        self.scopes.push(HashSet::new());
    }

    fn pop(&mut self) {
        self.scopes.pop();
    }

    fn bind(&mut self, name: &'s str) {
        self.scopes.last_mut().expect("scope stack").insert(name);
    }

    fn collect_macro_names(&mut self, stmt: &'s ast::Stmt<'s>) {
        use ast::Stmt::*;
        match stmt {
            Template(t) => {
                for child in &t.children {
                    self.collect_macro_names(child);
                }
            }
            ForLoop(f) => {
                self.collect_macro_names_in_expr(&f.iter);
                for child in &f.body {
                    self.collect_macro_names(child);
                }
                for child in &f.else_body {
                    self.collect_macro_names(child);
                }
            }
            IfCond(i) => {
                self.collect_macro_names_in_expr(&i.expr);
                for child in &i.true_body {
                    self.collect_macro_names(child);
                }
                for child in &i.false_body {
                    self.collect_macro_names(child);
                }
            }
            WithBlock(w) => {
                for (_, value) in &w.assignments {
                    self.collect_macro_names_in_expr(value);
                }
                for child in &w.body {
                    self.collect_macro_names(child);
                }
            }
            Set(s) => self.collect_macro_names_in_expr(&s.expr),
            SetBlock(s) => {
                for child in &s.body {
                    self.collect_macro_names(child);
                }
            }
            AutoEscape(a) => {
                self.collect_macro_names_in_expr(&a.enabled);
                for child in &a.body {
                    self.collect_macro_names(child);
                }
            }
            FilterBlock(f) => {
                for child in &f.body {
                    self.collect_macro_names(child);
                }
            }
            Macro(m) => {
                self.macros.insert(m.name);
                for default in &m.defaults {
                    self.collect_macro_names_in_expr(default);
                }
                for child in &m.body {
                    self.collect_macro_names(child);
                }
            }
            CallBlock(c) => {
                self.collect_macro_names_in_call(&c.call);
                self.macros.insert(c.macro_decl.name);
                for child in &c.macro_decl.body {
                    self.collect_macro_names(child);
                }
            }
            Do(d) => self.collect_macro_names_in_call(&d.call),
            Block(b) => {
                for child in &b.body {
                    self.collect_macro_names(child);
                }
            }
            EmitExpr(e) => self.collect_macro_names_in_expr(&e.expr),
            EmitRaw(_) | Continue(_) | Break(_) => {}
            Extends(_) | Include(_) | Import(_) | FromImport(_) => {}
        }
    }

    fn collect_macro_names_in_expr(&mut self, expr: &'s ast::Expr<'s>) {
        use ast::Expr::*;
        match expr {
            Var(v) => {
                if self.macros.contains(v.id) {
                    return;
                }
                let _ = v;
            }
            Slice(s) => {
                self.collect_macro_names_in_expr(&s.expr);
                if let Some(e) = &s.start {
                    self.collect_macro_names_in_expr(e);
                }
                if let Some(e) = &s.stop {
                    self.collect_macro_names_in_expr(e);
                }
                if let Some(e) = &s.step {
                    self.collect_macro_names_in_expr(e);
                }
            }
            UnaryOp(u) => self.collect_macro_names_in_expr(&u.expr),
            BinOp(b) => {
                self.collect_macro_names_in_expr(&b.left);
                self.collect_macro_names_in_expr(&b.right);
            }
            Compare(c) => {
                self.collect_macro_names_in_expr(&c.expr);
                for op in &c.ops {
                    self.collect_macro_names_in_expr(&op.expr);
                }
            }
            IfExpr(i) => {
                self.collect_macro_names_in_expr(&i.test_expr);
                self.collect_macro_names_in_expr(&i.true_expr);
                if let Some(e) = &i.false_expr {
                    self.collect_macro_names_in_expr(e);
                }
            }
            Filter(f) => {
                if let Some(e) = &f.expr {
                    self.collect_macro_names_in_expr(e);
                }
                for arg in &f.args {
                    self.collect_macro_names_in_call_arg(arg);
                }
            }
            Test(t) => {
                self.collect_macro_names_in_expr(&t.expr);
                for arg in &t.args {
                    self.collect_macro_names_in_call_arg(arg);
                }
            }
            GetAttr(g) => self.collect_macro_names_in_expr(&g.expr),
            GetItem(g) => {
                self.collect_macro_names_in_expr(&g.expr);
                self.collect_macro_names_in_expr(&g.subscript_expr);
            }
            Call(c) => {
                self.collect_macro_names_in_expr(&c.expr);
                for arg in &c.args {
                    self.collect_macro_names_in_call_arg(arg);
                }
            }
            List(l) => {
                for item in &l.items {
                    self.collect_macro_names_in_expr(item);
                }
            }
            Map(m) => {
                for key in &m.keys {
                    self.collect_macro_names_in_expr(key);
                }
                for value in &m.values {
                    self.collect_macro_names_in_expr(value);
                }
            }
            Const(_) => {}
        }
    }

    fn collect_macro_names_in_call_arg(&mut self, arg: &'s ast::CallArg<'s>) {
        use ast::CallArg::*;
        match arg {
            Pos(expr) | PosSplat(expr) | KwargSplat(expr) => {
                self.collect_macro_names_in_expr(expr);
            }
            Kwarg(_, expr) => self.collect_macro_names_in_expr(expr),
        }
    }

    fn collect_macro_names_in_call(&mut self, call: &'s ast::Spanned<ast::Call<'s>>) {
        self.collect_macro_names_in_expr(&call.expr);
        for arg in &call.args {
            self.collect_macro_names_in_call_arg(arg);
        }
    }

    fn walk_stmt(&mut self, stmt: &'s ast::Stmt<'s>) -> Result<(), TemplateError> {
        use ast::Stmt::*;
        match stmt {
            Template(t) => {
                for child in &t.children {
                    self.walk_stmt(child)?;
                }
                Ok(())
            }
            EmitExpr(e) => self.walk_expr(&e.expr),
            EmitRaw(_) => Ok(()),
            ForLoop(f) => {
                self.walk_expr(&f.iter)?;
                if let Some(filter) = &f.filter_expr {
                    self.walk_expr(filter)?;
                }
                self.push();
                self.bind_pattern(&f.target)?;
                self.bind("loop");
                for child in &f.body {
                    self.walk_stmt(child)?;
                }
                self.pop();
                for child in &f.else_body {
                    self.walk_stmt(child)?;
                }
                Ok(())
            }
            IfCond(i) => {
                self.walk_expr(&i.expr)?;
                for child in &i.true_body {
                    self.walk_stmt(child)?;
                }
                for child in &i.false_body {
                    self.walk_stmt(child)?;
                }
                Ok(())
            }
            WithBlock(w) => {
                self.push();
                for (target, value) in &w.assignments {
                    self.walk_expr(value)?;
                    self.bind_pattern(target)?;
                }
                for child in &w.body {
                    self.walk_stmt(child)?;
                }
                self.pop();
                Ok(())
            }
            Set(s) => {
                self.walk_expr(&s.expr)?;
                self.bind_pattern(&s.target)
            }
            SetBlock(s) => {
                for child in &s.body {
                    self.walk_stmt(child)?;
                }
                self.bind_pattern(&s.target)
            }
            AutoEscape(a) => {
                self.walk_expr(&a.enabled)?;
                for child in &a.body {
                    self.walk_stmt(child)?;
                }
                Ok(())
            }
            FilterBlock(f) => {
                for child in &f.body {
                    self.walk_stmt(child)?;
                }
                Ok(())
            }
            Macro(m) => {
                for default in &m.defaults {
                    self.walk_expr(default)?;
                }
                self.push();
                for arg in &m.args {
                    self.bind_pattern(arg)?;
                }
                for child in &m.body {
                    self.walk_stmt(child)?;
                }
                self.pop();
                Ok(())
            }
            CallBlock(c) => {
                self.walk_call(&c.call)?;
                self.push();
                for arg in &c.macro_decl.args {
                    self.bind_pattern(arg)?;
                }
                for child in &c.macro_decl.body {
                    self.walk_stmt(child)?;
                }
                self.pop();
                Ok(())
            }
            Do(d) => self.walk_call(&d.call),
            Block(b) => {
                for child in &b.body {
                    self.walk_stmt(child)?;
                }
                Ok(())
            }
            Continue(_) | Break(_) => Ok(()),
            Extends(_) => Err(TemplateError::Import("{% extends %}".to_owned())),
            Include(_) => Err(TemplateError::Import("{% include %}".to_owned())),
            Import(_) => Err(TemplateError::Import("{% import %}".to_owned())),
            FromImport(_) => Err(TemplateError::Import("{% from ... import %}".to_owned())),
        }
    }

    /// Binds assignment-pattern names. A plain `Var` target is a local; a
    /// dotted target (`a.b`) is an attribute write on an existing value, so
    /// its base is a reference.
    fn bind_pattern(&mut self, target: &'s ast::Expr<'s>) -> Result<(), TemplateError> {
        use ast::Expr::*;
        match target {
            Var(v) => {
                self.bind(v.id);
                Ok(())
            }
            List(l) => {
                for item in &l.items {
                    self.bind_pattern(item)?;
                }
                Ok(())
            }
            GetAttr(g) => self.walk_expr(&g.expr),
            _ => Ok(()),
        }
    }

    fn walk_expr(&mut self, expr: &'s ast::Expr<'s>) -> Result<(), TemplateError> {
        use ast::Expr::*;
        match expr {
            Var(v) => {
                if !self.is_local(v.id)
                    && !BUILTINS.contains(&v.id)
                    && !self.macros.contains(v.id)
                    && v.id != "self"
                {
                    self.referenced.insert(v.id);
                }
                Ok(())
            }
            Const(_) => Ok(()),
            Slice(s) => {
                self.walk_expr(&s.expr)?;
                if let Some(e) = &s.start {
                    self.walk_expr(e)?;
                }
                if let Some(e) = &s.stop {
                    self.walk_expr(e)?;
                }
                if let Some(e) = &s.step {
                    self.walk_expr(e)?;
                }
                Ok(())
            }
            UnaryOp(u) => self.walk_expr(&u.expr),
            BinOp(b) => {
                self.walk_expr(&b.left)?;
                self.walk_expr(&b.right)
            }
            Compare(c) => {
                self.walk_expr(&c.expr)?;
                for op in &c.ops {
                    self.walk_expr(&op.expr)?;
                }
                Ok(())
            }
            IfExpr(i) => {
                self.walk_expr(&i.test_expr)?;
                self.walk_expr(&i.true_expr)?;
                if let Some(e) = &i.false_expr {
                    self.walk_expr(e)?;
                }
                Ok(())
            }
            Filter(f) => {
                if let Some(e) = &f.expr {
                    self.walk_expr(e)?;
                }
                for arg in &f.args {
                    self.walk_call_arg(arg)?;
                }
                Ok(())
            }
            Test(t) => {
                self.walk_expr(&t.expr)?;
                for arg in &t.args {
                    self.walk_call_arg(arg)?;
                }
                Ok(())
            }
            GetAttr(g) => self.walk_expr(&g.expr),
            GetItem(g) => {
                self.walk_expr(&g.expr)?;
                self.walk_expr(&g.subscript_expr)
            }
            Call(c) => {
                self.walk_expr(&c.expr)?;
                for arg in &c.args {
                    self.walk_call_arg(arg)?;
                }
                Ok(())
            }
            List(l) => {
                for item in &l.items {
                    self.walk_expr(item)?;
                }
                Ok(())
            }
            Map(m) => {
                for key in &m.keys {
                    self.walk_expr(key)?;
                }
                for value in &m.values {
                    self.walk_expr(value)?;
                }
                Ok(())
            }
        }
    }

    fn walk_call_arg(&mut self, arg: &'s ast::CallArg<'s>) -> Result<(), TemplateError> {
        use ast::CallArg::*;
        match arg {
            Pos(expr) | PosSplat(expr) | KwargSplat(expr) => self.walk_expr(expr),
            Kwarg(_, expr) => self.walk_expr(expr),
        }
    }

    fn walk_call(&mut self, call: &'s ast::Spanned<ast::Call<'s>>) -> Result<(), TemplateError> {
        self.walk_expr(&call.expr)?;
        for arg in &call.args {
            self.walk_call_arg(arg)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{TemplateError, analyze, render};

    fn params(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn accepts_exact_match() {
        assert!(
            analyze(
                "#SBATCH --nodes={{ size }}\n./solver --backend {{ backend }}\n",
                &params(&["size", "backend"])
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_undefined_and_unused() {
        let err = analyze("{{ size }}", &params(&["size", "backend"])).unwrap_err();
        match err {
            TemplateError::Mismatch { undefined, unused } => {
                assert!(undefined.is_empty());
                assert_eq!(unused, ["backend"]);
            }
            other => panic!("expected mismatch, got {other:?}"),
        }

        let err = analyze("{{ size }} {{ nodes }}", &params(&["size"])).unwrap_err();
        match err {
            TemplateError::Mismatch { undefined, unused } => {
                assert_eq!(undefined, ["nodes"]);
                assert!(unused.is_empty());
            }
            other => panic!("expected mismatch, got {other:?}"),
        }
    }

    #[test]
    fn loops_conditionals_filters_and_set_are_fine() {
        assert!(analyze(
            "{% set n = size|int %}{% for i in range(n) %}{{ i }} {% endfor %}{% if backend == \"cuda\" %}gpu{% endif %}",
            &params(&["size", "backend"])
        )
        .is_ok());
    }

    #[test]
    fn loop_and_set_targets_are_not_params() {
        assert!(
            analyze(
                "{% for mesh in meshes %}{{ mesh }}{% endfor %}{% set x = size %}{{ x }}",
                &params(&["meshes", "size"])
            )
            .is_ok()
        );
    }

    #[test]
    fn loop_variable_is_not_a_reference_outside_the_loop() {
        let err = analyze("{{ loop.index }}", &params(&[])).unwrap_err();
        assert!(matches!(err, TemplateError::Mismatch { .. }));
    }

    #[test]
    fn loop_variable_inside_a_loop_is_fine() {
        assert!(
            analyze(
                "{% for m in meshes %}{{ loop.index }} {{ m }}{% endfor %}",
                &params(&["meshes"])
            )
            .is_ok()
        );
    }

    #[test]
    fn rejects_include_extends_and_import() {
        for source in [
            "{% include \"other.tmpl\" %}",
            "{% extends \"base.tmpl\" %}",
            "{% import \"m.tmpl\" as m %}",
            "{% from \"m.tmpl\" import foo %}",
        ] {
            let err = analyze(source, &params(&[])).unwrap_err();
            assert!(matches!(err, TemplateError::Import(_)), "{source}: {err:?}");
        }
    }

    #[test]
    fn renders_with_strict_undefined() {
        let mut map = std::collections::BTreeMap::new();
        map.insert("size".to_owned(), "256".to_owned());
        assert_eq!(render("nodes={{ size }}", &map).unwrap(), "nodes=256");
        assert!(render("nodes={{ nope }}", &map).is_err());
    }

    #[test]
    fn filters_do_not_count_as_variables() {
        assert!(analyze("{{ size|int }}", &params(&["size"])).is_ok());
        assert!(analyze("{{ size is defined }}", &params(&["size"])).is_ok());
    }

    #[test]
    fn macro_calls_are_not_variable_references() {
        assert!(
            analyze(
                "{% macro label(x) %}[{{ x }}]{% endmacro %}{{ label(size) }}",
                &params(&["size"])
            )
            .is_ok()
        );
    }

    #[test]
    fn attribute_reads_do_not_count_attributes_as_variables() {
        assert!(analyze("{{ solver.gpu }}", &params(&["solver"])).is_ok());
    }

    #[test]
    fn method_calls_on_params_are_fine() {
        assert!(analyze("{{ text|upper }}", &params(&["text"])).is_ok());
        assert!(analyze("{{ params.get(\"a\") }}", &params(&["params"])).is_ok());
    }
}
