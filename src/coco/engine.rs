//! The engine: every operation the convention defines, over registered
//! folders (convention §1–§12).
//!
//! The engine is synchronous and script-driven: it renders templates, invokes
//! the folder's own scripts as argv, and maintains the folder's records. It
//! never invents a cluster state — `PENDING`, `RUNNING`, `COMPLETED`,
//! `FAILED`, `CANCELLED` and `UNREACHABLE` come from the poll script and from
//! nowhere else.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Local;

use crate::coco::error::CocoError;
use crate::coco::invoke::{self, Invocation, coco_return_lines};
use crate::coco::manifest::{JobManifest, Manifest};
use crate::coco::record::{
    BenchMember, BenchMembersFile, BenchMembersFileMember, BenchRecord, BenchReport, LaunchFailure,
    RunRecord,
};
use crate::coco::status::Status;
use crate::coco::store::{Store, write_atomic};
use crate::coco::template;

/// Timeouts (convention §6). Defaults are the documented ones; tunable later.
#[derive(Clone, Debug)]
pub struct Config {
    pub launch_timeout: Duration,
    pub poll_timeout: Duration,
    pub cancel_timeout: Duration,
    pub plan_timeout: Duration,
    pub report_timeout: Duration,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            launch_timeout: Duration::from_secs(60),
            poll_timeout: Duration::from_secs(60),
            cancel_timeout: Duration::from_secs(60),
            plan_timeout: Duration::from_secs(120),
            report_timeout: Duration::from_secs(600),
        }
    }
}

/// A registered folder as it looks on one listing: path plus the manifest
/// re-read fresh, or its error. A broken manifest stays visible (§4).
#[derive(Debug)]
pub struct EntityView {
    pub path: PathBuf,
    pub manifest: Result<Manifest, CocoError>,
}

/// One row of a job's history. A malformed `run.json` fails that run only and
/// is shown as a broken row carrying its error (§12).
#[derive(Debug)]
pub struct JobRunView {
    pub run_id: u64,
    pub record: Result<RunRecord, CocoError>,
}

/// One bench run record (bench status is derived, never stored, §9.1).
#[derive(Debug)]
pub struct BenchRunView {
    pub run_id: u64,
    pub record: Result<BenchRecord, CocoError>,
}

#[derive(Clone, Debug, Default)]
pub struct PollReport {
    /// Number of active runs the poll was asked to speak for.
    pub polled: usize,
    pub changed: Vec<(u64, Status)>,
    pub warnings: Vec<String>,
}

/// One validated plan instance, ready to dispatch (§8.1).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlanInstance {
    pub job_path: PathBuf,
    pub job_name: String,
    pub render: BTreeMap<String, String>,
    pub launch: BTreeMap<String, String>,
}

impl PlanInstance {
    /// Combined render + launch params, one flat map. Unambiguous because a
    /// name cannot appear in both sets (§2.1).
    pub fn all_params(&self) -> BTreeMap<String, String> {
        let mut all = self.render.clone();
        all.extend(self.launch.clone());
        all
    }
}

#[derive(Clone, Debug)]
pub struct BenchStart {
    pub run_id: u64,
    pub members: Vec<BenchMember>,
    pub launch_failures: Vec<LaunchFailure>,
}

#[derive(Clone, Debug)]
pub struct MemberCancel {
    pub run_id: u64,
    pub job: String,
    pub ok: bool,
    pub error: Option<String>,
}

/// The derived status of one bench run (§9.1), plus the counts a progress
/// display needs.
#[derive(Clone, Debug)]
pub struct BenchStatus {
    pub status: Status,
    pub missing_members: Vec<String>,
    pub succeeded: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub running: usize,
    pub errors: usize,
}

#[derive(Debug, Default)]
pub struct RefreshReport {
    pub polls: usize,
    pub poll_changes: Vec<(u64, Status)>,
    pub poll_warnings: Vec<String>,
    pub poll_errors: Vec<CocoError>,
    pub reports_run: usize,
    pub report_errors: Vec<CocoError>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReportMode {
    /// Triggered by the refresh tick when a run reaches `COMPLETED`.
    Auto,
    /// Triggered by the user; never changes a run's status on failure.
    Manual,
}

/// The engine over one private store.
pub struct Coco {
    store_path: PathBuf,
    store: Store,
    config: Config,
}

impl Coco {
    pub fn new(store_path: impl Into<PathBuf>) -> Result<Self, CocoError> {
        Self::with_config(store_path, Config::default())
    }

    pub fn with_config(store_path: impl Into<PathBuf>, config: Config) -> Result<Self, CocoError> {
        let store_path = store_path.into();
        let store = Store::load(&store_path)?;
        Ok(Self {
            store_path,
            store,
            config,
        })
    }

    pub fn store_path(&self) -> &Path {
        &self.store_path
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    /// Values used by the most recent start of each entity, keyed by the
    /// entity's platform-wide unique manifest name (§5).
    pub fn last_args(&self) -> &BTreeMap<String, BTreeMap<String, String>> {
        &self.store.last_args
    }

    // ------------------------------------------------------------------
    // Registration and listing
    // ------------------------------------------------------------------

    /// Registers a folder by path (§1, §5). Registering a path already in the
    /// store is a no-op; a valid manifest whose name collides with an
    /// already-registered entity is refused.
    pub fn register(&mut self, path: &Path) -> Result<(), CocoError> {
        let canonical = fs::canonicalize(path).map_err(|source| CocoError::io(path, source))?;
        if !canonical.is_dir() {
            return Err(CocoError::validation(format!(
                "{} is not a folder",
                canonical.display()
            )));
        }
        if self.store.contains(&canonical) {
            return Ok(());
        }
        if let Ok(manifest) = Manifest::load(&canonical)
            && let Some(existing) = self.find_name_collision(manifest.name())
        {
            return Err(CocoError::NameCollision(existing));
        }
        self.store.add(canonical);
        self.store.save(&self.store_path)
    }

    /// Removes a folder from the store. The folder and its records are
    /// untouched.
    pub fn unregister(&mut self, path: &Path) -> Result<(), CocoError> {
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if !self.store.remove(&canonical) {
            return Err(CocoError::not_found(format!(
                "entity {}",
                canonical.display()
            )));
        }
        self.store.save(&self.store_path)
    }

    /// All registered entities, with manifests re-read fresh (§4).
    pub fn entities(&self) -> Vec<EntityView> {
        self.store
            .entities
            .iter()
            .map(|path| EntityView {
                path: path.clone(),
                manifest: Manifest::load(path),
            })
            .collect()
    }

    pub fn entity(&self, path: &Path) -> Result<EntityView, CocoError> {
        let canonical = fs::canonicalize(path).map_err(|source| CocoError::io(path, source))?;
        if !self.store.contains(&canonical) {
            return Err(CocoError::not_found(format!(
                "entity {}",
                canonical.display()
            )));
        }
        Ok(EntityView {
            path: canonical.clone(),
            manifest: Manifest::load(&canonical),
        })
    }

    pub fn job_manifest(&self, path: &Path) -> Result<JobManifest, CocoError> {
        let view = self.entity(path)?;
        let manifest = view.manifest?;
        manifest.as_job().cloned().ok_or_else(|| {
            CocoError::validation(format!("{} is a bench, not a job", view.path.display()))
        })
    }

    /// A job's history, newest first. `runs/` is readable on its own (§1);
    /// broken records appear as broken rows, not as blank history (§12).
    pub fn job_runs(&self, path: &Path) -> Result<Vec<JobRunView>, CocoError> {
        let runs_dir = path.join("runs");
        let mut runs = Vec::new();
        let entries = match fs::read_dir(&runs_dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(runs),
            Err(source) => return Err(CocoError::io(&runs_dir, source)),
        };
        for entry in entries {
            let entry = entry.map_err(|source| CocoError::io(&runs_dir, source))?;
            let Some(run_id) = entry.file_name().to_string_lossy().parse::<u64>().ok() else {
                continue;
            };
            let record = self.read_run_record(path, run_id);
            runs.push(JobRunView { run_id, record });
        }
        runs.sort_by_key(|view| std::cmp::Reverse(view.run_id));
        Ok(runs)
    }

    pub fn run_record(&self, path: &Path, run_id: u64) -> Result<RunRecord, CocoError> {
        self.read_run_record(path, run_id)
    }

    pub fn bench_runs(&self, path: &Path) -> Result<Vec<BenchRunView>, CocoError> {
        let runs_dir = path.join("runs");
        let mut runs = Vec::new();
        let entries = match fs::read_dir(&runs_dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(runs),
            Err(source) => return Err(CocoError::io(&runs_dir, source)),
        };
        for entry in entries {
            let entry = entry.map_err(|source| CocoError::io(&runs_dir, source))?;
            let Some(run_id) = entry.file_name().to_string_lossy().parse::<u64>().ok() else {
                continue;
            };
            let record = self.read_bench_record(path, run_id);
            runs.push(BenchRunView { run_id, record });
        }
        runs.sort_by_key(|view| std::cmp::Reverse(view.run_id));
        Ok(runs)
    }

    pub fn bench_record(&self, path: &Path, run_id: u64) -> Result<BenchRecord, CocoError> {
        self.read_bench_record(path, run_id)
    }

    // ------------------------------------------------------------------
    // Job operations
    // ------------------------------------------------------------------

    /// Starts a job: allocates a run id, renders the template, invokes
    /// `launch`, and writes the record only once a submission id is known
    /// (§7.1). A failed launch leaves the rendered artifact in place and
    /// records nothing.
    pub fn start_job(
        &mut self,
        path: &Path,
        render: BTreeMap<String, String>,
        launch: BTreeMap<String, String>,
    ) -> Result<u64, CocoError> {
        self.start_job_inner(path, render, launch, None)
    }

    fn start_job_inner(
        &mut self,
        path: &Path,
        render: BTreeMap<String, String>,
        launch: BTreeMap<String, String>,
        origin: Option<(u64, String)>,
    ) -> Result<u64, CocoError> {
        let manifest = self.job_manifest(path)?;
        validate_params(&manifest.render_params, &render, "render")?;
        validate_params(&manifest.launch_params, &launch, "launch")?;

        let template_path = path.join(&manifest.template);
        let source = fs::read_to_string(&template_path)
            .map_err(|source| CocoError::io(&template_path, source))?;
        template::analyze(&source, &manifest.render_params)
            .map_err(|e| CocoError::template(&template_path, e.to_string()))?;
        let rendered = template::render(&source, &render)
            .map_err(|e| CocoError::template(&template_path, e.to_string()))?;

        let run_id = self.store.allocate_run_id(&self.store_path)?;
        let run_dir = path.join("runs").join(run_id.to_string());
        fs::create_dir_all(&run_dir).map_err(|source| CocoError::io(&run_dir, source))?;

        let artifact_name = artifact_name(&manifest.template);
        fs::write(run_dir.join(&artifact_name), rendered)
            .map_err(|source| CocoError::io(run_dir.join(&artifact_name), source))?;

        let mut argv = manifest.launch.words.clone();
        argv.push("--script".to_owned());
        argv.push(format!("runs/{run_id}/{artifact_name}"));
        argv.push("--run".to_owned());
        argv.push(run_id.to_string());
        for (name, value) in &launch {
            argv.push(format!("--{name}"));
            argv.push(value.clone());
        }

        let invocation = invoke::run(path, &argv, self.config.launch_timeout)
            .map_err(|source| CocoError::io(path, source))?;
        let submission_id = parse_launch_return(&invocation).map_err(|detail| {
            invocation_error(manifest.launch.display.clone(), &invocation, &detail)
        })?;

        let record = RunRecord::new(
            run_id,
            submission_id,
            render.clone(),
            launch.clone(),
            origin,
            Local::now(),
        );
        self.write_run_record(path, &record)?;

        let mut last_args = render.clone();
        last_args.extend(launch);
        self.store
            .last_args
            .insert(manifest.name.clone(), last_args);
        self.store.save(&self.store_path)?;
        Ok(run_id)
    }

    /// Polls one job's active runs through the job's own `poll` script
    /// (§7.2, §10). A non-zero exit or timeout moves the job's active runs to
    /// `UNREACHABLE` and is also returned as a loud operation error.
    pub fn poll_job(&mut self, path: &Path) -> Result<PollReport, CocoError> {
        let manifest = self.job_manifest(path)?;
        let active: Vec<(u64, RunRecord)> = self
            .job_runs(path)?
            .into_iter()
            .filter_map(|view| {
                view.record
                    .ok()
                    .filter(|record| !record.status.is_terminal())
                    .map(|record| (record.run_id, record))
            })
            .collect();

        let mut report = PollReport {
            polled: active.len(),
            changed: Vec::new(),
            warnings: Vec::new(),
        };
        if active.is_empty() {
            return Ok(report);
        }

        let by_submission: BTreeMap<String, (u64, RunRecord)> = active
            .into_iter()
            .map(|(run_id, record)| (record.submission_id.clone(), (run_id, record)))
            .collect();
        let submissions: Vec<String> = by_submission.keys().cloned().collect();

        let mut argv = manifest.poll.words.clone();
        argv.push("--submissions".to_owned());
        argv.push(submissions.join(","));
        let invocation = invoke::run(path, &argv, self.config.poll_timeout)
            .map_err(|source| CocoError::io(path, source))?;

        if !invocation.ok() {
            let reason = format!("poll script failed: {}", invocation.output());
            let now = Local::now();
            for (run_id, mut record) in by_submission.into_values() {
                if record.status != Status::Unreachable {
                    record.apply_status(Status::Unreachable, now, Some(reason.clone()));
                    self.write_run_record(path, &record)?;
                    report.changed.push((run_id, Status::Unreachable));
                }
            }
            return Err(CocoError::Invocation {
                script: manifest.poll.display.clone(),
                exit: invocation.exit,
                timed_out: invocation.timed_out,
                output: invocation.output(),
            });
        }

        let lines = coco_return_lines(&invocation.stdout);
        let status_lines: Vec<&str> = lines
            .iter()
            .filter(|line| line.split_whitespace().next() != Some("UNREACHABLE"))
            .copied()
            .collect();
        let unreachable_reasons: Vec<String> = lines
            .iter()
            .filter_map(|line| {
                let mut parts = line.splitn(2, char::is_whitespace);
                (parts.next() == Some("UNREACHABLE"))
                    .then(|| parts.next().unwrap_or("").trim().to_owned())
            })
            .collect();

        let now = Local::now();
        if !status_lines.is_empty() {
            for line in status_lines {
                let mut parts = line.splitn(3, char::is_whitespace);
                let (Some(submission), Some(word)) = (parts.next(), parts.next()) else {
                    report
                        .warnings
                        .push(format!("malformed poll line ignored: `{line}`"));
                    continue;
                };
                let reason = parts.next().map(str::trim).filter(|r| !r.is_empty());
                let Some((run_id, record)) = by_submission.get(submission) else {
                    report.warnings.push(format!(
                        "poll line for unknown submission `{submission}` ignored"
                    ));
                    continue;
                };
                let Some(status) = Status::from_poll_word(word) else {
                    report
                        .warnings
                        .push(format!("unknown status `{word}` for run {run_id} ignored"));
                    continue;
                };
                if record.status.is_terminal() {
                    continue;
                }
                if record.status != status {
                    let mut record = record.clone();
                    record.apply_status(status, now, reason.map(str::to_owned));
                    self.write_run_record(path, &record)?;
                    report.changed.push((*run_id, status));
                }
            }
        } else if !unreachable_reasons.is_empty() {
            let reason = unreachable_reasons
                .last()
                .cloned()
                .filter(|r| !r.is_empty());
            for (run_id, mut record) in by_submission.into_values() {
                if record.status != Status::Unreachable {
                    record.apply_status(Status::Unreachable, now, reason.clone());
                    self.write_run_record(path, &record)?;
                    report.changed.push((run_id, Status::Unreachable));
                }
            }
        }
        Ok(report)
    }

    /// Runs the report script for one run (§7.3, §11).
    ///
    /// Auto mode is the `COMPLETED → ANALYZING → SUCCEEDED` lifecycle: a
    /// failure leaves the run at `ERROR` with the captured output attached.
    /// Manual mode never changes a run's status on failure, and a successful
    /// manual re-run heals a report-failed `ERROR` back to `SUCCEEDED`.
    pub fn report_run(
        &mut self,
        path: &Path,
        run_id: u64,
        mode: ReportMode,
    ) -> Result<(), CocoError> {
        let manifest = self.job_manifest(path)?;
        let record = self.run_record(path, run_id)?;

        let eligible = match mode {
            ReportMode::Auto => {
                matches!(record.status, Status::Completed | Status::Analyzing)
            }
            ReportMode::Manual => match record.status {
                Status::Completed | Status::Analyzing | Status::Succeeded => true,
                Status::Error => record.history.iter().any(|c| c.status == Status::Completed),
                _ => false,
            },
        };
        if !eligible {
            return Err(CocoError::validation(format!(
                "run {run_id} ({}) cannot be reported",
                record.status.label()
            )));
        }

        if record.status != Status::Analyzing {
            let mut updated = record.clone();
            updated.apply_status(Status::Analyzing, Local::now(), None);
            self.write_run_record(path, &updated)?;
        }

        let report_dir = path.join("report");
        fs::create_dir_all(&report_dir).map_err(|source| CocoError::io(&report_dir, source))?;
        let mut argv = manifest.report.words.clone();
        argv.push("--run".to_owned());
        argv.push(run_id.to_string());
        argv.push("--submission".to_owned());
        argv.push(record.submission_id.clone());
        let invocation = invoke::run(path, &argv, self.config.report_timeout)
            .map_err(|source| CocoError::io(path, source))?;

        let report_path = report_dir.join(format!("{run_id}.txt"));
        let file_ok = report_path.is_file();

        if invocation.ok() && file_ok {
            let mut record = self.run_record(path, run_id)?;
            record.apply_status(Status::Succeeded, Local::now(), None);
            record.error = None;
            self.write_run_record(path, &record)?;
            Ok(())
        } else {
            let detail = if invocation.ok() {
                format!("report script exited 0 but produced no report/{run_id}.txt")
            } else {
                invocation.output()
            };
            let error = CocoError::Invocation {
                script: manifest.report.display.clone(),
                exit: invocation.exit,
                timed_out: invocation.timed_out,
                output: detail.clone(),
            };
            if mode == ReportMode::Auto {
                let mut record = self.run_record(path, run_id)?;
                record.apply_status(Status::Error, Local::now(), None);
                record.error = Some(detail);
                self.write_run_record(path, &record)?;
            }
            Err(error)
        }
    }

    /// Cancels one run through the job's `cancel` script (§7.4). A non-zero
    /// exit or timeout is a cancel failure: the run keeps its current status.
    pub fn cancel_run(&mut self, path: &Path, run_id: u64) -> Result<(), CocoError> {
        let manifest = self.job_manifest(path)?;
        let mut record = self.run_record(path, run_id)?;
        if !record.status.is_cancellable() {
            return Err(CocoError::validation(format!(
                "run {run_id} ({}) cannot be cancelled",
                record.status.label()
            )));
        }
        let mut argv = manifest.cancel.words.clone();
        argv.push("--submission".to_owned());
        argv.push(record.submission_id.clone());
        let invocation = invoke::run(path, &argv, self.config.cancel_timeout)
            .map_err(|source| CocoError::io(path, source))?;
        if invocation.ok() {
            record.apply_status(Status::Cancelling, Local::now(), None);
            self.write_run_record(path, &record)?;
            Ok(())
        } else {
            Err(CocoError::Invocation {
                script: manifest.cancel.display.clone(),
                exit: invocation.exit,
                timed_out: invocation.timed_out,
                output: invocation.output(),
            })
        }
    }

    // ------------------------------------------------------------------
    // Bench operations
    // ------------------------------------------------------------------

    /// Runs `plan` and validates every instance before anything is submitted
    /// (§8.1): the job must be registered, its manifest valid, and its
    /// parameters exactly the job's render + launch sets, all strings.
    pub fn plan_bench(
        &mut self,
        path: &Path,
        params: BTreeMap<String, String>,
    ) -> Result<Vec<PlanInstance>, CocoError> {
        let manifest = self.bench_manifest(path)?;
        validate_params(&manifest.plan_params, &params, "plan")?;

        let mut argv = manifest.plan.words.clone();
        for (name, value) in &params {
            argv.push(format!("--{name}"));
            argv.push(value.clone());
        }
        let invocation = invoke::run(path, &argv, self.config.plan_timeout)
            .map_err(|source| CocoError::io(path, source))?;
        if !invocation.ok() {
            return Err(CocoError::Invocation {
                script: manifest.plan.display.clone(),
                exit: invocation.exit,
                timed_out: invocation.timed_out,
                output: invocation.output(),
            });
        }

        let lines = coco_return_lines(&invocation.stdout);
        if lines.is_empty() {
            return Err(CocoError::validation(
                "plan produced no instances; a bench start needs at least one",
            ));
        }

        let mut instances = Vec::new();
        for (index, line) in lines.iter().enumerate() {
            let call = index + 1;
            let planned = parse_plan_line(line)
                .map_err(|e| CocoError::validation(format!("plan call {call}: {e}")))?;
            let (job_path, job) = self.find_job_by_name(&planned.job).ok_or_else(|| {
                CocoError::validation(format!(
                    "plan call {call}: `{}` is not a registered job",
                    planned.job
                ))
            })?;
            let expected: BTreeSet<&str> = job
                .render_params
                .iter()
                .chain(&job.launch_params)
                .map(String::as_str)
                .collect();
            let provided: BTreeSet<&str> = planned.params.keys().map(String::as_str).collect();
            if expected != provided {
                let missing: Vec<&str> = expected.difference(&provided).copied().collect();
                let extra: Vec<&str> = provided.difference(&expected).copied().collect();
                return Err(CocoError::validation(format!(
                    "plan call {call}: params for job `{}` must be exactly its declared sets; \
                     missing {}, extra {}",
                    planned.job,
                    describe_names(&missing),
                    describe_names(&extra)
                )));
            }
            let render = planned
                .params
                .iter()
                .filter(|(name, _)| job.render_params.contains(name))
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            let launch = planned
                .params
                .iter()
                .filter(|(name, _)| job.launch_params.contains(name))
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect();
            instances.push(PlanInstance {
                job_path,
                job_name: job.name.clone(),
                render,
                launch,
            });
        }
        Ok(instances)
    }

    /// Starts a bench: validates the plan, allocates the bench's run id, then
    /// dispatches every instance through its own job's `launch` (§8.2). A
    /// failed dispatch never aborts the rest; failures are recorded in the
    /// bench record and the bench settles at `ERROR`.
    pub fn start_bench(
        &mut self,
        path: &Path,
        params: BTreeMap<String, String>,
    ) -> Result<BenchStart, CocoError> {
        let manifest = self.bench_manifest(path)?;
        let instances = self.plan_bench(path, params.clone())?;
        let bench_run_id = self.store.allocate_run_id(&self.store_path)?;

        let mut members = Vec::new();
        let mut launch_failures = Vec::new();
        for instance in instances {
            match self.start_job_inner(
                &instance.job_path,
                instance.render.clone(),
                instance.launch.clone(),
                Some((bench_run_id, manifest.name.clone())),
            ) {
                Ok(run_id) => members.push(BenchMember {
                    run_id,
                    job: instance.job_name.clone(),
                }),
                Err(error) => launch_failures.push(LaunchFailure {
                    job: instance.job_name.clone(),
                    params: instance.all_params(),
                    error: error.to_string(),
                }),
            }
        }

        let record = BenchRecord {
            run_id: bench_run_id,
            bench: manifest.name.clone(),
            started_at: Local::now(),
            params: params.clone(),
            planned: members.len() + launch_failures.len(),
            members,
            launch_failures: launch_failures.clone(),
            report: None,
        };
        self.write_bench_record(path, &record)?;
        self.store.last_args.insert(manifest.name.clone(), params);
        self.store.save(&self.store_path)?;

        Ok(BenchStart {
            run_id: bench_run_id,
            members: record.members,
            launch_failures,
        })
    }

    /// Runs the bench's report over its members' results (§8.3). Only a bench
    /// whose every member succeeded and nothing failed to launch may report —
    /// not automatically and not by hand.
    pub fn bench_report(
        &mut self,
        path: &Path,
        run_id: u64,
        _mode: ReportMode,
    ) -> Result<(), CocoError> {
        let manifest = self.bench_manifest(path)?;
        let mut record = self.bench_record(path, run_id)?;

        let resolved = self.resolve_members(&record);
        let mut block_reason = String::new();
        if !record.launch_failures.is_empty() {
            block_reason.push_str(&format!(
                "{} launch(es) failed",
                record.launch_failures.len()
            ));
        }
        for member in &resolved {
            match &member.record {
                None => {
                    if !block_reason.is_empty() {
                        block_reason.push_str(", ");
                    }
                    block_reason.push_str(&format!(
                        "member `{}` run {} cannot be resolved",
                        member.job_name, member.run_id
                    ));
                }
                Some(member_record) if member_record.status != Status::Succeeded => {
                    if !block_reason.is_empty() {
                        block_reason.push_str(", ");
                    }
                    block_reason.push_str(&format!(
                        "member `{}` run {} ended {}",
                        member.job_name,
                        member.run_id,
                        member_record.status.label()
                    ));
                }
                _ => {}
            }
        }
        if !block_reason.is_empty() {
            return Err(CocoError::validation(format!(
                "no bench report: {block_reason}"
            )));
        }

        let run_dir = path.join("runs").join(run_id.to_string());
        let members_file = BenchMembersFile {
            run_id,
            bench: record.bench.clone(),
            params: record.params.clone(),
            members: resolved
                .iter()
                .map(|member| {
                    let member_record = member.record.as_ref().expect("all members resolved");
                    BenchMembersFileMember {
                        run_id: member.run_id,
                        job: member.job_name.clone(),
                        params: member_record.all_params(),
                        submission_id: member_record.submission_id.clone(),
                        report: member
                            .job_path
                            .as_deref()
                            .expect("every member in a successful sweep resolves to a path")
                            .join("report")
                            .join(format!("{}.txt", member.run_id)),
                    }
                })
                .collect(),
        };
        let json = serde_json::to_vec_pretty(&members_file)
            .map_err(|e| CocoError::store(run_dir.join("members.json"), e.to_string()))?;
        write_atomic(&run_dir.join("members.json"), &json)?;

        let report_dir = path.join("report");
        fs::create_dir_all(&report_dir).map_err(|source| CocoError::io(&report_dir, source))?;
        let mut argv = manifest.report.words.clone();
        argv.push("--run".to_owned());
        argv.push(run_id.to_string());
        argv.push("--members".to_owned());
        argv.push(format!("runs/{run_id}/members.json"));
        let invocation = invoke::run(path, &argv, self.config.report_timeout)
            .map_err(|source| CocoError::io(path, source))?;

        let report_path = report_dir.join(format!("{run_id}.txt"));
        let ok = invocation.ok() && report_path.is_file();
        let error = if ok {
            None
        } else if invocation.ok() {
            Some(format!(
                "report script exited 0 but produced no report/{run_id}.txt"
            ))
        } else {
            Some(invocation.output())
        };
        record.report = Some(BenchReport {
            attempted: true,
            error: error.clone(),
        });
        self.write_bench_record(path, &record)?;

        if ok {
            Ok(())
        } else {
            Err(CocoError::Invocation {
                script: manifest.report.display.clone(),
                exit: invocation.exit,
                timed_out: invocation.timed_out,
                output: error.unwrap_or_default(),
            })
        }
    }

    /// Cancels a bench run by cancelling its still-cancellable members, each
    /// through that member job's own `cancel` (§3, §9.1). Members that cannot
    /// be cancelled (already terminal, or post-work) keep their result.
    pub fn cancel_bench(
        &mut self,
        path: &Path,
        run_id: u64,
    ) -> Result<Vec<MemberCancel>, CocoError> {
        let record = self.bench_record(path, run_id)?;
        let mut results = Vec::new();
        for member in &record.members {
            let (job_path, _) = self.find_job_by_name(&member.job).ok_or_else(|| {
                CocoError::not_found(format!("member job `{}` of bench run {run_id}", member.job))
            })?;
            let Ok(member_record) = self.run_record(&job_path, member.run_id) else {
                continue;
            };
            if !member_record.status.is_cancellable() {
                continue;
            }
            match self.cancel_run(&job_path, member.run_id) {
                Ok(()) => results.push(MemberCancel {
                    run_id: member.run_id,
                    job: member.job.clone(),
                    ok: true,
                    error: None,
                }),
                Err(error) => results.push(MemberCancel {
                    run_id: member.run_id,
                    job: member.job.clone(),
                    ok: false,
                    error: Some(error.to_string()),
                }),
            }
        }
        Ok(results)
    }

    /// Derives a bench run's status from its members, launch failures, and
    /// report lifecycle (§9.1). Never stored, never cached.
    pub fn bench_status(&self, path: &Path, run_id: u64) -> Result<BenchStatus, CocoError> {
        let record = self.bench_record(path, run_id)?;
        let resolved = self.resolve_members(&record);
        let missing: Vec<String> = resolved
            .iter()
            .filter(|member| member.record.is_none())
            .map(|member| member.job_name.clone())
            .collect();
        let members: Vec<&RunRecord> = resolved
            .iter()
            .filter_map(|member| member.record.as_ref())
            .collect();

        let status = if !missing.is_empty() {
            Status::Error
        } else {
            derive_bench_status(&members, &record, report_on_disk(path, run_id))
        };

        let mut counts = BenchStatus {
            status,
            missing_members: missing,
            succeeded: 0,
            failed: 0,
            cancelled: 0,
            running: 0,
            errors: 0,
        };
        for member in members {
            match member.status {
                Status::Succeeded => counts.succeeded += 1,
                Status::Failed => counts.failed += 1,
                Status::Cancelled => counts.cancelled += 1,
                Status::Error => counts.errors += 1,
                _ => counts.running += 1,
            }
        }
        Ok(counts)
    }

    // ------------------------------------------------------------------
    // Refresh
    // ------------------------------------------------------------------

    /// One refresh tick: polls every job with active runs, auto-reports
    /// `COMPLETED` runs, and advances bench reports once their members all
    /// succeeded (§7.5, §10).
    pub fn refresh(&mut self) -> RefreshReport {
        let mut report = RefreshReport::default();
        let entities: Vec<(PathBuf, Result<Manifest, CocoError>)> = self
            .entities()
            .into_iter()
            .map(|view| (view.path, view.manifest))
            .collect();

        for (path, manifest) in entities {
            let Ok(manifest) = manifest else { continue };
            match manifest {
                Manifest::Job(_) => {
                    report.polls += 1;
                    match self.poll_job(&path) {
                        Ok(poll) => {
                            report.poll_changes.extend(poll.changed);
                            report.poll_warnings.extend(poll.warnings);
                        }
                        Err(error) => report.poll_errors.push(error),
                    }
                    let Ok(runs) = self.job_runs(&path) else {
                        continue;
                    };
                    for view in runs {
                        let Ok(record) = &view.record else { continue };
                        if matches!(record.status, Status::Completed | Status::Analyzing) {
                            report.reports_run += 1;
                            if let Err(error) =
                                self.report_run(&path, view.run_id, ReportMode::Auto)
                            {
                                report.report_errors.push(error);
                            }
                        }
                    }
                }
                Manifest::Bench(_) => {
                    let Ok(runs) = self.bench_runs(&path) else {
                        continue;
                    };
                    for view in runs {
                        let Ok(record) = &view.record else { continue };
                        let needs_report = record
                            .report
                            .as_ref()
                            .map(|report| !report.attempted)
                            .unwrap_or(true);
                        if !needs_report {
                            continue;
                        }
                        if let Ok(status) = self.bench_status(&path, view.run_id)
                            && status.status == Status::Analyzing
                        {
                            report.reports_run += 1;
                            if let Err(error) =
                                self.bench_report(&path, view.run_id, ReportMode::Auto)
                            {
                                report.report_errors.push(error);
                            }
                        }
                    }
                }
            }
        }
        report
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    fn find_name_collision(&self, name: &str) -> Option<String> {
        self.store.entities.iter().find_map(|path| {
            Manifest::load(path)
                .ok()
                .filter(|manifest| manifest.name() == name)
                .map(|manifest| manifest.name().to_owned())
        })
    }

    fn find_job_by_name(&self, name: &str) -> Option<(PathBuf, JobManifest)> {
        for path in &self.store.entities {
            if let Ok(Manifest::Job(job)) = Manifest::load(path)
                && job.name == name
            {
                return Some((path.clone(), job));
            }
        }
        None
    }

    pub fn bench_manifest(
        &self,
        path: &Path,
    ) -> Result<crate::coco::manifest::BenchManifest, CocoError> {
        let view = self.entity(path)?;
        let manifest = view.manifest?;
        manifest.as_bench().cloned().ok_or_else(|| {
            CocoError::validation(format!("{} is a job, not a bench", view.path.display()))
        })
    }

    fn read_run_record(&self, path: &Path, run_id: u64) -> Result<RunRecord, CocoError> {
        let record_path = path.join("runs").join(run_id.to_string()).join("run.json");
        match fs::read_to_string(&record_path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| {
                CocoError::store(&record_path, format!("run.json does not parse: {e}"))
            }),
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => Err(
                CocoError::not_found(format!("run {run_id} in {}", path.display())),
            ),
            Err(source) => Err(CocoError::io(&record_path, source)),
        }
    }

    fn write_run_record(&self, path: &Path, record: &RunRecord) -> Result<(), CocoError> {
        let record_path = path
            .join("runs")
            .join(record.run_id.to_string())
            .join("run.json");
        let json = serde_json::to_vec_pretty(record)
            .map_err(|e| CocoError::store(&record_path, e.to_string()))?;
        write_atomic(&record_path, &json)
    }

    fn read_bench_record(&self, path: &Path, run_id: u64) -> Result<BenchRecord, CocoError> {
        let record_path = path.join("runs").join(run_id.to_string()).join("run.json");
        match fs::read_to_string(&record_path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| {
                CocoError::store(&record_path, format!("run.json does not parse: {e}"))
            }),
            Err(source) if source.kind() == std::io::ErrorKind::NotFound => Err(
                CocoError::not_found(format!("bench run {run_id} in {}", path.display())),
            ),
            Err(source) => Err(CocoError::io(&record_path, source)),
        }
    }

    fn write_bench_record(&self, path: &Path, record: &BenchRecord) -> Result<(), CocoError> {
        let record_path = path
            .join("runs")
            .join(record.run_id.to_string())
            .join("run.json");
        let json = serde_json::to_vec_pretty(record)
            .map_err(|e| CocoError::store(&record_path, e.to_string()))?;
        write_atomic(&record_path, &json)
    }

    fn resolve_members(&self, record: &BenchRecord) -> Vec<ResolvedMember> {
        record
            .members
            .iter()
            .map(|member| {
                let found = self.find_job_by_name(&member.job);
                let member_record = match &found {
                    Some((job_path, _)) => self.read_run_record(job_path, member.run_id).ok(),
                    None => None,
                };
                ResolvedMember {
                    run_id: member.run_id,
                    job_name: member.job.clone(),
                    job_path: found.map(|(path, _)| path),
                    record: member_record,
                }
            })
            .collect()
    }
}

struct ResolvedMember {
    run_id: u64,
    job_name: String,
    job_path: Option<PathBuf>,
    record: Option<RunRecord>,
}

struct PlanLine {
    job: String,
    params: BTreeMap<String, String>,
}

/// The bench status derivation (§9.1), over fully-resolved members.
fn derive_bench_status(
    members: &[&RunRecord],
    bench: &BenchRecord,
    report_on_disk: bool,
) -> Status {
    // 2. Any member CANCELLING → CANCELLING.
    if members
        .iter()
        .any(|member| member.status == Status::Cancelling)
    {
        return Status::Cancelling;
    }
    // 3. Any member non-terminal → RUNNING, or STARTING while every member is.
    if members.iter().any(|member| !member.status.is_terminal()) {
        if members
            .iter()
            .all(|member| member.status == Status::Starting)
        {
            return Status::Starting;
        }
        return Status::Running;
    }
    // 4. All members terminal.
    if !bench.launch_failures.is_empty() || members.iter().any(|m| m.status == Status::Error) {
        return Status::Error;
    }
    if members.iter().any(|m| m.status == Status::Failed) {
        return Status::Failed;
    }
    if members.iter().any(|m| m.status == Status::Cancelled) {
        return Status::Cancelled;
    }
    // 5. All succeeded, nothing failed to launch: the bench's own report
    //    decides.
    if let Some(report) = &bench.report {
        if report.attempted && report.error.is_some() {
            return Status::Error;
        }
        if report.attempted && !report_on_disk {
            return Status::Error;
        }
    }
    if report_on_disk {
        Status::Succeeded
    } else {
        Status::Analyzing
    }
}

fn report_on_disk(path: &Path, run_id: u64) -> bool {
    path.join("report").join(format!("{run_id}.txt")).is_file()
}

/// Strips a trailing `.tmpl` from the template's file name (§6.1).
fn artifact_name(template: &Path) -> String {
    let name = template
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "artifact".to_owned());
    match name.strip_suffix(".tmpl") {
        Some(stripped) if !stripped.is_empty() => stripped.to_owned(),
        _ => name,
    }
}

/// The declared params and the provided values must be exactly the same set
/// (§2: every declared parameter must be supplied at start, by hand).
fn validate_params(
    declared: &[String],
    provided: &BTreeMap<String, String>,
    set: &str,
) -> Result<(), CocoError> {
    let declared_set: BTreeSet<&str> = declared.iter().map(String::as_str).collect();
    let provided_set: BTreeSet<&str> = provided.keys().map(String::as_str).collect();
    let missing: Vec<&str> = declared_set.difference(&provided_set).copied().collect();
    let extra: Vec<&str> = provided_set.difference(&declared_set).copied().collect();
    if missing.is_empty() && extra.is_empty() {
        Ok(())
    } else {
        Err(CocoError::validation(format!(
            "{set} parameters must match the manifest exactly; missing {}, extra {}",
            describe_names(&missing),
            describe_names(&extra)
        )))
    }
}

fn describe_names(names: &[&str]) -> String {
    if names.is_empty() {
        "none".to_owned()
    } else {
        names
            .iter()
            .map(|name| format!("`{name}`"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// A launch must exit 0 and print exactly one `COCO_RETURN:` line whose
/// payload is a single non-empty token (§7.1).
fn parse_launch_return(invocation: &Invocation) -> Result<String, String> {
    if invocation.timed_out || invocation.exit != Some(0) {
        return Err(String::new());
    }
    let lines = coco_return_lines(&invocation.stdout);
    let last = lines
        .last()
        .ok_or_else(|| "script printed no COCO_RETURN: line".to_owned())?;
    if last.is_empty() || last.split_whitespace().count() != 1 {
        return Err("COCO_RETURN: payload must be a single token".to_owned());
    }
    Ok((*last).to_owned())
}

fn parse_plan_line(line: &str) -> Result<PlanLine, String> {
    let value: serde_json::Value =
        serde_json::from_str(line).map_err(|e| format!("not a JSON object: {e}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "must be a JSON object".to_owned())?;
    let job = object
        .get("job")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "missing string field `job`".to_owned())?;
    let params_object = object
        .get("params")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "missing object field `params`".to_owned())?;
    let mut params = BTreeMap::new();
    for (name, value) in params_object {
        let value = value
            .as_str()
            .ok_or_else(|| format!("param `{name}` must be a string"))?;
        params.insert(name.clone(), value.to_owned());
    }
    Ok(PlanLine {
        job: job.to_owned(),
        params,
    })
}

fn invocation_error(script: String, invocation: &Invocation, detail: &str) -> CocoError {
    let output = if detail.is_empty() {
        invocation.output()
    } else {
        format!("{detail}\n{}", invocation.output())
    };
    CocoError::Invocation {
        script,
        exit: invocation.exit,
        timed_out: invocation.timed_out,
        output,
    }
}
