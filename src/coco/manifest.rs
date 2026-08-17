//! Manifest loading and validation (convention §2–§4).
//!
//! A manifest either loads or it does not. Everything coco knows about an
//! experiment folder — its name, its kind, its scripts, its parameters — comes
//! from this file, and a folder whose manifest is broken stays visible with
//! its error rather than being dropped.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::coco::error::CocoError;
use crate::coco::template;
use crate::coco::words::split_command;

/// What an entity is. A **job** is independently launchable; a **bench** is a
/// fan-out launcher over already-registered jobs (convention §2, §3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Job,
    Bench,
}

impl Kind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Job => "job",
            Self::Bench => "bench",
        }
    }
}

/// A `command` value, split into argv at load time.
///
/// The split is lexical only: quotes and escapes group characters, no shell
/// runs, nothing expands (convention §2, §3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Command {
    pub words: Vec<String>,
    /// The manifest's original `command` string, for display and errors.
    pub display: String,
}

impl Command {
    fn parse(raw: String) -> Result<Self, String> {
        let words = split_command(&raw)?;
        if words.is_empty() {
            return Err("command is empty".to_owned());
        }
        Ok(Self {
            words,
            display: raw,
        })
    }
}

/// A job manifest (convention §2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobManifest {
    pub name: String,
    pub description: Option<String>,
    /// Relative path of the template inside the folder.
    pub template: PathBuf,
    pub render_params: Vec<String>,
    pub launch: Command,
    pub launch_params: Vec<String>,
    pub poll: Command,
    pub report: Command,
    pub cancel: Command,
}

/// A bench manifest (convention §3).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BenchManifest {
    pub name: String,
    pub description: Option<String>,
    pub plan: Command,
    pub plan_params: Vec<String>,
    pub report: Command,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Manifest {
    Job(JobManifest),
    Bench(BenchManifest),
}

impl Manifest {
    pub fn name(&self) -> &str {
        match self {
            Self::Job(m) => &m.name,
            Self::Bench(m) => &m.name,
        }
    }

    pub fn kind(&self) -> Kind {
        match self {
            Self::Job(_) => Kind::Job,
            Self::Bench(_) => Kind::Bench,
        }
    }

    pub fn description(&self) -> Option<&str> {
        match self {
            Self::Job(m) => m.description.as_deref(),
            Self::Bench(m) => m.description.as_deref(),
        }
    }

    pub fn as_job(&self) -> Option<&JobManifest> {
        match self {
            Self::Job(m) => Some(m),
            Self::Bench(_) => None,
        }
    }

    pub fn as_bench(&self) -> Option<&BenchManifest> {
        match self {
            Self::Bench(m) => Some(m),
            Self::Job(_) => None,
        }
    }

    /// Loads and validates `folder/coco.toml` (convention §4).
    ///
    /// The template is read and checked here, too: both directions of the
    /// exact-match rule are verified when the manifest loads, so a mismatch is
    /// visible before anyone tries to start anything.
    pub fn load(folder: &Path) -> Result<Self, CocoError> {
        let manifest_path = folder.join("coco.toml");
        if !manifest_path.is_file() {
            return Err(CocoError::manifest(folder, "no coco.toml in this folder"));
        }
        let text = fs::read_to_string(&manifest_path)
            .map_err(|source| CocoError::io(&manifest_path, source))?;
        let value: toml::Value = toml::from_str(&text).map_err(|e| {
            CocoError::manifest(&manifest_path, format!("coco.toml does not parse: {e}"))
        })?;

        let kind = value
            .get("kind")
            .and_then(toml::Value::as_str)
            .unwrap_or("");
        match kind {
            "job" => Self::load_job(folder, &manifest_path, &text),
            "bench" => Self::load_bench(folder, &manifest_path, &text),
            "" => Err(CocoError::manifest(
                &manifest_path,
                "missing required key `kind`",
            )),
            other => Err(CocoError::manifest(
                &manifest_path,
                format!("`kind` must be `job` or `bench`, found `{other}`"),
            )),
        }
    }

    fn load_job(folder: &Path, manifest_path: &Path, text: &str) -> Result<Self, CocoError> {
        let raw: RawJob = toml::from_str(text)
            .map_err(|e| CocoError::manifest(manifest_path, format!("invalid manifest: {e}")))?;

        let name = require_name(raw.name, manifest_path)?;
        let render = raw.render.ok_or_else(|| {
            CocoError::manifest(manifest_path, "missing required table `[render]`")
        })?;
        let launch = raw.launch.ok_or_else(|| {
            CocoError::manifest(manifest_path, "missing required table `[launch]`")
        })?;
        let poll = raw
            .poll
            .ok_or_else(|| CocoError::manifest(manifest_path, "missing required table `[poll]`"))?;
        let report = raw.report.ok_or_else(|| {
            CocoError::manifest(manifest_path, "missing required table `[report]`")
        })?;
        let cancel = raw.cancel.ok_or_else(|| {
            CocoError::manifest(manifest_path, "missing required table `[cancel]`")
        })?;

        let template_name = require_string(render.template, manifest_path, "[render].template")?;
        let render_params = require_params(render.params, manifest_path, "[render].params")?;
        let launch_params = require_params(launch.params, manifest_path, "[launch].params")?;

        let overlap: Vec<&String> = render_params
            .iter()
            .filter(|name| launch_params.contains(name))
            .collect();
        if !overlap.is_empty() {
            return Err(CocoError::manifest(
                manifest_path,
                format!(
                    "parameter `{}` appears in both `[render].params` and `[launch].params`",
                    overlap[0]
                ),
            ));
        }

        let template_rel = PathBuf::from(&template_name);
        let template_abs = require_file_in_folder(folder, manifest_path, &template_rel)?;
        let source = fs::read_to_string(&template_abs)
            .map_err(|source| CocoError::io(&template_abs, source))?;
        template::analyze(&source, &render_params).map_err(|e| {
            CocoError::manifest(
                &template_abs,
                format!("template does not match `[render].params`: {e}"),
            )
        })?;

        Ok(Self::Job(JobManifest {
            name,
            description: raw.description,
            template: template_rel,
            render_params,
            launch: Command::parse(require_string(
                launch.command,
                manifest_path,
                "[launch].command",
            )?)
            .map_err(|e| CocoError::manifest(manifest_path, format!("[launch].command {e}")))?,
            launch_params,
            poll: Command::parse(require_string(
                poll.command,
                manifest_path,
                "[poll].command",
            )?)
            .map_err(|e| CocoError::manifest(manifest_path, format!("[poll].command {e}")))?,
            report: Command::parse(require_string(
                report.command,
                manifest_path,
                "[report].command",
            )?)
            .map_err(|e| CocoError::manifest(manifest_path, format!("[report].command {e}")))?,
            cancel: Command::parse(require_string(
                cancel.command,
                manifest_path,
                "[cancel].command",
            )?)
            .map_err(|e| CocoError::manifest(manifest_path, format!("[cancel].command {e}")))?,
        }))
    }

    fn load_bench(_folder: &Path, manifest_path: &Path, text: &str) -> Result<Self, CocoError> {
        let raw: RawBench = toml::from_str(text)
            .map_err(|e| CocoError::manifest(manifest_path, format!("invalid manifest: {e}")))?;

        let name = require_name(raw.name, manifest_path)?;
        let plan = raw
            .plan
            .ok_or_else(|| CocoError::manifest(manifest_path, "missing required table `[plan]`"))?;
        let report = raw.report.ok_or_else(|| {
            CocoError::manifest(manifest_path, "missing required table `[report]`")
        })?;

        let plan_params = require_params(plan.params, manifest_path, "[plan].params")?;

        Ok(Self::Bench(BenchManifest {
            name,
            description: raw.description,
            plan: Command::parse(require_string(
                plan.command,
                manifest_path,
                "[plan].command",
            )?)
            .map_err(|e| CocoError::manifest(manifest_path, format!("[plan].command {e}")))?,
            plan_params,
            report: Command::parse(require_string(
                report.command,
                manifest_path,
                "[report].command",
            )?)
            .map_err(|e| CocoError::manifest(manifest_path, format!("[report].command {e}")))?,
        }))
    }
}

fn require_name(name: Option<String>, path: &Path) -> Result<String, CocoError> {
    match name {
        Some(name) if !name.is_empty() => Ok(name),
        Some(_) => Err(CocoError::manifest(
            path,
            "`name` must be a non-empty string",
        )),
        None => Err(CocoError::manifest(path, "missing required key `name`")),
    }
}

fn require_string(value: Option<String>, path: &Path, key: &str) -> Result<String, CocoError> {
    match value {
        Some(value) => Ok(value),
        None => Err(CocoError::manifest(
            path,
            format!("missing required key `{key}`"),
        )),
    }
}

fn require_params(
    value: Option<Vec<String>>,
    path: &Path,
    key: &str,
) -> Result<Vec<String>, CocoError> {
    let params = match value {
        Some(params) => params,
        None => {
            return Err(CocoError::manifest(
                path,
                format!("missing required key `{key}`"),
            ));
        }
    };
    let mut seen = BTreeSet::new();
    for name in &params {
        if name.is_empty() {
            return Err(CocoError::manifest(
                path,
                format!("`{key}` contains an empty parameter name"),
            ));
        }
        if !seen.insert(name.clone()) {
            return Err(CocoError::manifest(
                path,
                format!("`{key}` declares duplicate parameter `{name}`"),
            ));
        }
    }
    Ok(params)
}

fn require_file_in_folder(
    folder: &Path,
    manifest_path: &Path,
    rel: &Path,
) -> Result<PathBuf, CocoError> {
    let joined = folder.join(rel);
    let canonical = match fs::canonicalize(&joined) {
        Ok(canonical) => canonical,
        Err(_) => {
            return Err(CocoError::manifest(
                manifest_path,
                format!(
                    "`[render].template` `{}` is not a file in the folder",
                    rel.display()
                ),
            ));
        }
    };
    if !canonical.is_file() {
        return Err(CocoError::manifest(
            manifest_path,
            format!(
                "`[render].template` `{}` is not a file in the folder",
                rel.display()
            ),
        ));
    }
    let folder_canon = fs::canonicalize(folder).map_err(|source| CocoError::io(folder, source))?;
    if !canonical.starts_with(&folder_canon) {
        return Err(CocoError::manifest(
            manifest_path,
            format!(
                "`[render].template` `{}` must be inside the folder",
                rel.display()
            ),
        ));
    }
    Ok(canonical)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawJob {
    #[allow(dead_code)]
    kind: Option<String>,
    name: Option<String>,
    description: Option<String>,
    render: Option<RawRender>,
    launch: Option<RawLaunch>,
    poll: Option<RawCommandOnly>,
    report: Option<RawCommandOnly>,
    cancel: Option<RawCommandOnly>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBench {
    #[allow(dead_code)]
    kind: Option<String>,
    name: Option<String>,
    description: Option<String>,
    plan: Option<RawPlan>,
    report: Option<RawCommandOnly>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRender {
    template: Option<String>,
    params: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawLaunch {
    command: Option<String>,
    params: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPlan {
    command: Option<String>,
    params: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCommandOnly {
    command: Option<String>,
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::Manifest;

    fn write(folder: &std::path::Path, name: &str, contents: &str) {
        fs::write(folder.join(name), contents).unwrap();
    }

    fn valid_job_toml() -> &'static str {
        r#"
kind        = "job"
name        = "solver-gpu"
description = "GPU solver sweep"

[render]
template    = "job.sbatch.tmpl"
params      = ["size", "backend"]

[launch]
command     = "./launch.sh"
params      = ["mesh", "gpu"]

[poll]
command     = "./poll.py"

[report]
command     = "./report.py"

[cancel]
command     = "./cancel.sh"
"#
    }

    #[test]
    fn loads_a_valid_job() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "coco.toml", valid_job_toml());
        write(
            dir.path(),
            "job.sbatch.tmpl",
            "#SBATCH --nodes={{ size }}\n./solver --backend {{ backend }}\n",
        );
        let manifest = Manifest::load(dir.path()).unwrap();
        let job = manifest.as_job().unwrap();
        assert_eq!(job.name, "solver-gpu");
        assert_eq!(job.render_params, ["size", "backend"]);
        assert_eq!(job.launch_params, ["mesh", "gpu"]);
        assert_eq!(job.launch.words, ["./launch.sh"]);
        assert_eq!(job.description.as_deref(), Some("GPU solver sweep"));
    }

    #[test]
    fn loads_a_valid_bench() {
        let dir = TempDir::new().unwrap();
        write(
            dir.path(),
            "coco.toml",
            r#"
kind        = "bench"
name        = "nightly-benchmark"

[plan]
command     = "./plan.sh"
params      = ["mesh"]

[report]
command     = "./report.py"
"#,
        );
        let manifest = Manifest::load(dir.path()).unwrap();
        let bench = manifest.as_bench().unwrap();
        assert_eq!(bench.name, "nightly-benchmark");
        assert_eq!(bench.plan_params, ["mesh"]);
    }

    #[test]
    fn accepts_empty_params_lists() {
        let dir = TempDir::new().unwrap();
        write(
            dir.path(),
            "coco.toml",
            &valid_job_toml().replace("params      = [\"size\", \"backend\"]", "params      = []"),
        );
        write(dir.path(), "job.sbatch.tmpl", "#SBATCH --nodes=4\n");
        assert!(Manifest::load(dir.path()).is_ok());
    }

    #[test]
    fn rejects_missing_kind_and_unknown_kind() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "coco.toml", "name = \"x\"\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("kind"), "{err}");

        write(
            dir.path(),
            "coco.toml",
            "kind = \"pipeline\"\nname = \"x\"\n",
        );
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("job") && err.contains("bench"), "{err}");
    }

    #[test]
    fn rejects_missing_name_and_empty_name() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "coco.toml", "kind = \"job\"\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("name"), "{err}");

        write(dir.path(), "coco.toml", "kind = \"job\"\nname = \"\"\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("non-empty"), "{err}");
    }

    #[test]
    fn rejects_unknown_keys_at_every_level() {
        let dir = TempDir::new().unwrap();
        write(
            dir.path(),
            "coco.toml",
            r#"
kind = "job"
name = "x"
[render]
template = "job.sbatch.tmpl"
params = []
[launch]
command = "./launch.sh"
params = []
[extra]
"#,
        );
        write(dir.path(), "job.sbatch.tmpl", "plain\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("unknown field"), "{err}");
    }

    #[test]
    fn rejects_bench_with_job_tables() {
        let dir = TempDir::new().unwrap();
        write(
            dir.path(),
            "coco.toml",
            r#"
kind = "bench"
name = "b"
[plan]
command = "./plan.sh"
params = []
[launch]
command = "./launch.sh"
params = []
"#,
        );
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("unknown field"), "{err}");
    }

    #[test]
    fn rejects_missing_required_tables_and_commands() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "coco.toml", "kind = \"job\"\nname = \"x\"\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("[render]"), "{err}");

        write(
            dir.path(),
            "coco.toml",
            "kind = \"job\"\nname = \"x\"\n[render]\ntemplate = \"t.tmpl\"\nparams = []\n[launch]\ncommand = \"./l\"\nparams = []\n[poll]\n[report]\ncommand = \"./r\"\n[cancel]\ncommand = \"./c\"\n",
        );
        write(dir.path(), "t.tmpl", "plain\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("[poll]"), "{err}");
    }

    #[test]
    fn rejects_non_word_splitting_commands() {
        let dir = TempDir::new().unwrap();
        write(
            dir.path(),
            "coco.toml",
            &valid_job_toml().replace(
                "command     = \"./poll.py\"",
                "command     = \"./poll.py 'oops\"",
            ),
        );
        write(dir.path(), "job.sbatch.tmpl", "{{ size }} {{ backend }}\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("unclosed"), "{err}");
    }

    #[test]
    fn rejects_overlapping_render_and_launch_params() {
        let dir = TempDir::new().unwrap();
        write(
            dir.path(),
            "coco.toml",
            &valid_job_toml().replace(
                "params      = [\"mesh\", \"gpu\"]",
                "params      = [\"size\", \"backend\"]",
            ),
        );
        write(dir.path(), "job.sbatch.tmpl", "{{ size }} {{ backend }}\n");
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("both"), "{err}");
    }

    #[test]
    fn rejects_missing_template_file() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "coco.toml", valid_job_toml());
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("template"), "{err}");
    }

    #[test]
    fn rejects_missing_manifest() {
        let dir = TempDir::new().unwrap();
        let err = Manifest::load(dir.path()).unwrap_err().to_string();
        assert!(err.contains("coco.toml"), "{err}");
    }
}
