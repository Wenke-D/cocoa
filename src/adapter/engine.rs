//! The one adapter: drives the [`crate::engine`] engine and presents its data
//! through the snapshot model the UI renders from.
//!
//! The world is rebuilt lazily: every mutating operation marks it dirty, and
//! [`snapshot`](Self::snapshot) re-reads only then. Between changes the UI
//! gets the same cheap `Arc` clone every frame.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Local};

use crate::adapter::traits::{AddedFolders, CancelTarget, ExperimentError, Experiments};
use crate::engine::{BenchRecord, Coco, EngineError, Manifest, RunRecord, Status};
use crate::view_model::world::{Snapshot, World};
use crate::view_model::{
    BenchPlan, BenchPlanStep, BenchRun, Entity, EntityId, EntityKind, JobRun, ManifestState,
    QueryHealth, ReportFormat, ReportState, RunId, RunOrigin, RunStatus,
};

/// How often `tick` polls every job and advances reports, automatically.
const AUTO_REFRESH_INTERVAL: chrono::TimeDelta = chrono::TimeDelta::seconds(3);

/// How deep an Add Folder pick looks for experiment folders below the chosen
/// directory.
const SCAN_DEPTH: usize = 3;

pub struct EngineAdapter {
    coco: Coco,
    world: RefCell<Option<Arc<World>>>,
    dirty: Cell<bool>,
    last_refresh: Option<DateTime<Local>>,
}

impl EngineAdapter {
    pub fn new(coco: Coco) -> Self {
        Self {
            coco,
            world: RefCell::new(None),
            dirty: Cell::new(true),
            last_refresh: None,
        }
    }

    pub fn coco(&self) -> &Coco {
        &self.coco
    }

    fn mark_dirty(&mut self) {
        self.dirty.set(true);
    }

    fn build_world(&self, now: DateTime<Local>) -> World {
        let mut world = World::default();
        let entities = self.coco.entities();

        for view in entities {
            match &view.manifest {
                Ok(Manifest::Job(job)) => {
                    let parameter_names = job
                        .render_params
                        .iter()
                        .chain(&job.launch_params)
                        .cloned()
                        .collect();
                    world.entities.push(self.entity_for(
                        &view.path,
                        &job.name,
                        EntityKind::Job,
                        parameter_names,
                    ));
                    if let Ok(runs) = self.coco.job_runs(&view.path) {
                        for run_view in runs {
                            if let Ok(record) = run_view.record {
                                let run = self.job_run(&view.path, record, now);
                                let id = run.id.clone();
                                // Insert before indexing: the index reads the
                                // run's start time back out of the map.
                                world.job_runs.insert(id.clone(), run);
                                world.index_job_run(id);
                            }
                        }
                    }
                }
                Ok(Manifest::Bench(bench)) => {
                    world.entities.push(self.entity_for(
                        &view.path,
                        &bench.name,
                        EntityKind::Bench,
                        bench.plan_params.clone(),
                    ));
                    if let Ok(runs) = self.coco.bench_runs(&view.path) {
                        for run_view in runs {
                            if let Ok(record) = run_view.record {
                                let run = self.bench_run(&view.path, record, now);
                                let id = run.id.clone();
                                world.bench_runs.insert(id.clone(), run);
                                world.index_bench_run(id);
                            }
                        }
                    }
                }
                Err(error) => world.entities.push(Entity {
                    id: EntityId::new(view.path.display().to_string()),
                    kind: EntityKind::Job,
                    name: file_name(&view.path),
                    path: display_path(&view.path),
                    manifest: ManifestState::Invalid {
                        message: error.to_string(),
                    },
                    parameter_names: Vec::new(),
                    last_used: BTreeMap::new(),
                }),
            }
        }

        world.last_refresh = self.last_refresh;
        world
    }

    fn entity_for(
        &self,
        path: &Path,
        name: &str,
        kind: EntityKind,
        parameter_names: Vec<String>,
    ) -> Entity {
        let last_used = self.coco.last_args().get(name).cloned().unwrap_or_default();
        Entity {
            id: EntityId::new(path.display().to_string()),
            kind,
            name: name.to_owned(),
            path: display_path(path),
            manifest: ManifestState::Valid,
            parameter_names,
            last_used,
        }
    }

    fn job_run(&self, job_path: &Path, record: RunRecord, now: DateTime<Local>) -> JobRun {
        let (status, query_health) = display_status_of(&record);
        JobRun {
            id: RunId::new(record.run_id.to_string()),
            job_id: EntityId::new(job_path.display().to_string()),
            origin: self.origin_of(&record),
            started_at: record.started_at(),
            ended_at: record.ended_at(),
            parameters: format_params(&record.all_params()),
            status,
            query_health,
            last_successful_query: now,
            report: report_state(job_path, record.run_id),
            error: record.error.clone(),
        }
    }

    fn origin_of(&self, record: &RunRecord) -> RunOrigin {
        let (Some(bench_run_id), Some(bench_name)) = (record.bench, record.bench_name.as_deref())
        else {
            return RunOrigin::Direct;
        };
        let bench_id = self
            .find_bench_path_by_name(bench_name)
            .map(|path| EntityId::new(path.display().to_string()))
            .unwrap_or_else(|| EntityId::new(bench_name.to_owned()));
        let step_index = self
            .find_bench_path_by_name(bench_name)
            .and_then(|path| self.coco.bench_record(&path, bench_run_id).ok())
            .map(|bench_record| {
                bench_record
                    .members
                    .iter()
                    .position(|member| member.run_id == record.run_id)
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        RunOrigin::BenchStep {
            bench_id,
            bench_run_id: RunId::new(bench_run_id.to_string()),
            step_index,
        }
    }

    fn bench_run(&self, bench_path: &Path, record: BenchRecord, now: DateTime<Local>) -> BenchRun {
        let derived = self.coco.bench_status(bench_path, record.run_id);
        let status = derived
            .as_ref()
            .map(|status| map_status(status.status))
            .unwrap_or(RunStatus::Error);
        let plan = BenchPlan {
            steps: record
                .members
                .iter()
                .enumerate()
                .map(|(index, member)| BenchPlanStep {
                    index,
                    job_id: EntityId::new(
                        self.find_job_path_by_name(&member.job)
                            .map(|path| path.display().to_string())
                            .unwrap_or_else(|| member.job.clone()),
                    ),
                    parameters: self
                        .find_job_path_by_name(&member.job)
                        .and_then(|path| self.coco.run_record(&path, member.run_id).ok())
                        .map(|member_record| format_params(&member_record.all_params()))
                        .unwrap_or_default(),
                    run_id: RunId::new(member.run_id.to_string()),
                })
                .collect(),
        };
        BenchRun {
            id: RunId::new(record.run_id.to_string()),
            bench_id: EntityId::new(bench_path.display().to_string()),
            started_at: record.started_at,
            ended_at: None,
            parameters: format_params(&record.params),
            plan,
            status,
            query_health: QueryHealth::Healthy,
            last_successful_query: now,
            report: report_state(bench_path, record.run_id),
            error: None,
        }
    }

    fn find_job_path_by_name(&self, name: &str) -> Option<PathBuf> {
        self.coco
            .entities()
            .into_iter()
            .find_map(|view| match view.manifest {
                Ok(Manifest::Job(job)) if job.name == name => Some(view.path),
                _ => None,
            })
    }

    fn find_bench_path_by_name(&self, name: &str) -> Option<PathBuf> {
        self.coco
            .entities()
            .into_iter()
            .find_map(|view| match view.manifest {
                Ok(Manifest::Bench(bench)) if bench.name == name => Some(view.path),
                _ => None,
            })
    }

    fn find_run_folder(&self, run_id: u64) -> Option<PathBuf> {
        for view in self.coco.entities() {
            if let Ok(Manifest::Job(_)) = &view.manifest
                && let Ok(runs) = self.coco.job_runs(&view.path)
                && runs.iter().any(|run| run.run_id == run_id)
            {
                return Some(view.path);
            }
        }
        None
    }

    fn find_bench_run_folder(&self, run_id: u64) -> Option<PathBuf> {
        for view in self.coco.entities() {
            if let Ok(Manifest::Bench(_)) = &view.manifest
                && let Ok(runs) = self.coco.bench_runs(&view.path)
                && runs.iter().any(|run| run.run_id == run_id)
            {
                return Some(view.path);
            }
        }
        None
    }
}

impl Experiments for EngineAdapter {
    fn snapshot(&self) -> Snapshot {
        if self.dirty.get() || self.world.borrow().is_none() {
            let world = self.build_world(Local::now());
            let world = Arc::new(world);
            *self.world.borrow_mut() = Some(world.clone());
            self.dirty.set(false);
            return Snapshot::new(world);
        }
        Snapshot::new(self.world.borrow().clone().expect("world built"))
    }

    fn start(
        &mut self,
        entity_id: &EntityId,
        parameters: BTreeMap<String, String>,
    ) -> Result<RunId, ExperimentError> {
        let path = PathBuf::from(entity_id.as_str());
        let manifest = self
            .coco
            .entities()
            .into_iter()
            .find_map(|view| (view.path == path).then_some(view.manifest));
        let manifest = match manifest {
            Some(Ok(manifest)) => manifest,
            Some(Err(error)) => {
                return Err(ExperimentError::ManifestUnusable {
                    entity: entity_id.as_str().to_owned(),
                    reason: error.to_string(),
                });
            }
            None => return Err(ExperimentError::UnknownEntity(entity_id.clone())),
        };

        let run_id = match &manifest {
            Manifest::Job(job) => {
                let render = split_fields(&parameters, &job.render_params);
                let launch = split_fields(&parameters, &job.launch_params);
                self.coco.start_job(&path, render, launch)
            }
            Manifest::Bench(_) => self
                .coco
                .start_bench(&path, parameters)
                .map(|start| start.run_id),
        }
        .map_err(experiment_error)?;

        self.mark_dirty();
        Ok(RunId::new(run_id.to_string()))
    }

    fn cancel(&mut self, target: CancelTarget) -> Result<(), ExperimentError> {
        match &target {
            CancelTarget::JobRun(id) => {
                let run_id = parse_run_id(id)?;
                let folder = self
                    .find_run_folder(run_id)
                    .ok_or_else(|| ExperimentError::UnknownRun(id.clone()))?;
                self.coco
                    .cancel_run(&folder, run_id)
                    .map_err(experiment_error)?;
            }
            CancelTarget::BenchRun(id) => {
                let run_id = parse_run_id(id)?;
                let folder = self
                    .find_bench_run_folder(run_id)
                    .ok_or_else(|| ExperimentError::UnknownRun(id.clone()))?;
                self.coco
                    .cancel_bench(&folder, run_id)
                    .map_err(experiment_error)?;
            }
        }
        self.mark_dirty();
        Ok(())
    }

    fn refresh(&mut self) -> Result<(), ExperimentError> {
        let report = self.coco.refresh();
        self.last_refresh = Some(Local::now());
        self.mark_dirty();
        let errors: Vec<String> = report
            .poll_errors
            .iter()
            .chain(&report.report_errors)
            .map(ToString::to_string)
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(ExperimentError::Operation(match errors.as_slice() {
                [only] => only.clone(),
                _ => format!("{} (and {} more)", errors[0], errors.len() - 1),
            }))
        }
    }

    fn report(&self, run_id: &RunId) -> Result<ReportState, ExperimentError> {
        let run_id = parse_run_id(run_id)?;
        let folder = self
            .find_run_folder(run_id)
            .or_else(|| self.find_bench_run_folder(run_id))
            .ok_or_else(|| ExperimentError::UnknownRun(RunId::new(run_id.to_string())))?;
        Ok(report_state(&folder, run_id))
    }

    fn register_folder(&mut self, path: &Path) -> Result<AddedFolders, ExperimentError> {
        let folders = experiment_folders(path);
        // A single folder is the user's literal choice: its failure is the
        // action's failure. Within a scanned directory one bad folder must not
        // sink the rest, so it is reported alongside what did register.
        let single = folders.len() == 1;
        let known: HashSet<PathBuf> = self
            .coco
            .entities()
            .into_iter()
            .map(|entity| entity.path)
            .collect();

        let mut outcome = AddedFolders::default();
        for folder in folders {
            if known.contains(&folder) {
                outcome.already_registered += 1;
                continue;
            }
            match self.coco.register(&folder) {
                Ok(()) => outcome.added.push(file_name(&folder)),
                Err(EngineError::AlreadyRegistered(_)) => outcome.already_registered += 1,
                Err(error) if single => return Err(experiment_error(error)),
                Err(error) => outcome.refused.push(format!(
                    "{}: {}",
                    file_name(&folder),
                    experiment_error(error)
                )),
            }
        }

        self.mark_dirty();
        Ok(outcome)
    }

    fn tick(&mut self, now: DateTime<Local>) {
        let due = match self.last_refresh {
            Some(last) => now - last >= AUTO_REFRESH_INTERVAL,
            None => true,
        };
        if due {
            let _ = self.coco.refresh();
            self.last_refresh = Some(now);
            self.mark_dirty();
        }
    }
}

fn display_status_of(record: &RunRecord) -> (RunStatus, QueryHealth) {
    if record.status == Status::Unreachable {
        let last_known = record
            .history
            .iter()
            .rev()
            .find(|change| change.status != Status::Unreachable)
            .map(|change| map_status(change.status))
            .unwrap_or(RunStatus::Starting);
        let message = record
            .reason
            .clone()
            .unwrap_or_else(|| "unreachable".to_owned());
        return (last_known, QueryHealth::Unavailable { message });
    }
    (map_status(record.status), QueryHealth::Healthy)
}

fn map_status(status: Status) -> RunStatus {
    match status {
        Status::Starting => RunStatus::Starting,
        Status::Pending => RunStatus::Pending,
        Status::Running => RunStatus::Running,
        Status::Completed => RunStatus::Completed,
        Status::Analyzing => RunStatus::Analyzing,
        Status::Succeeded => RunStatus::Succeeded,
        Status::Failed => RunStatus::Failed,
        Status::Cancelling => RunStatus::Cancelling,
        Status::Cancelled => RunStatus::Cancelled,
        Status::Unreachable => RunStatus::Running,
        Status::Error => RunStatus::Error,
    }
}

fn report_state(folder: &Path, run_id: u64) -> ReportState {
    let report_dir = folder.join("report");
    let txt = report_dir.join(format!("{run_id}.txt"));
    if txt.is_file() {
        return match std::fs::read_to_string(&txt) {
            Ok(text) => ReportState::Available {
                format: ReportFormat::PlainText,
                text: Arc::from(text),
            },
            Err(error) => ReportState::ReadError {
                message: error.to_string(),
            },
        };
    }
    let html = report_dir.join(format!("{run_id}.html"));
    if html.is_file() {
        return match std::fs::read_to_string(&html) {
            Ok(text) => ReportState::Available {
                format: ReportFormat::Html,
                text: Arc::from(text),
            },
            Err(error) => ReportState::ReadError {
                message: error.to_string(),
            },
        };
    }
    ReportState::Missing
}

fn format_params(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(name, value)| format!("--{name} {value}"))
        .collect::<Vec<_>>()
        .join(" ")
}

fn split_fields(
    fields: &BTreeMap<String, String>,
    declared: &[String],
) -> BTreeMap<String, String> {
    declared
        .iter()
        .filter_map(|name| fields.get(name).map(|value| (name.clone(), value.clone())))
        .collect()
}

fn parse_run_id(id: &RunId) -> Result<u64, ExperimentError> {
    id.as_str()
        .parse()
        .map_err(|_| ExperimentError::UnknownRun(id.clone()))
}

fn experiment_error(error: EngineError) -> ExperimentError {
    match error {
        // The one engine failure the workbench words itself: a plan's bad calls
        // are a list the Start modal lays out, not a sentence (§15.4).
        EngineError::InvalidPlan { calls, problems } => {
            ExperimentError::InvalidPlan { calls, problems }
        }
        other => ExperimentError::Operation(other.to_string()),
    }
}

/// The folder path as the workbench writes it (specification §24.4).
///
/// Under the user's home it is written with a `~`. Anywhere else — a cluster's
/// `/scratch`, a mounted project volume, a path on a machine with no `HOME` at
/// all — it is shown as it is. Most experiment folders on a compute site live
/// outside home, so this shortens what it can and never rewrites what it
/// cannot.
pub fn display_path(path: &Path) -> String {
    fold_home(path, home_dir().as_deref())
}

/// The home the paths are compared against, canonical because the store holds
/// canonical paths: a symlinked home would otherwise never match.
fn home_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .filter(|home| !home.is_empty())?;
    let home = PathBuf::from(home);
    Some(std::fs::canonicalize(&home).unwrap_or(home))
}

/// Split out from [`display_path`] so the folding can be tested against a home
/// of the test's choosing rather than the machine's.
fn fold_home(path: &Path, home: Option<&Path>) -> String {
    let Some(home) = home else {
        return path.display().to_string();
    };
    // Component-wise, not textual: `/Users/wenke2` starts with the *string*
    // `/Users/wenke` and is a different person's home.
    match path.strip_prefix(home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_owned(),
        Ok(rest) => format!("~{}{}", std::path::MAIN_SEPARATOR, rest.display()),
        Err(_) => path.display().to_string(),
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

/// The experiment folders a picked directory offers.
///
/// The directory itself when it carries a manifest; otherwise every folder
/// beneath it that does, so picking `mock/` adds the whole bundled library in
/// one action. A directory with no manifest anywhere is returned unchanged, so
/// it lands in the Explorer with its manifest error visible (specification §11.5)
/// rather than disappearing into a dialog error.
fn experiment_folders(root: &Path) -> Vec<PathBuf> {
    fn collect(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
        if dir.join("coco.toml").is_file() {
            out.push(dir.to_owned());
            return;
        }
        if depth >= SCAN_DEPTH {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut children: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_dir() && !is_skipped(path))
            .collect();
        children.sort();
        for child in children {
            collect(&child, out, depth + 1);
        }
    }

    /// Hidden directories and the state an experiment folder generates are
    /// never experiment folders themselves.
    fn is_skipped(path: &Path) -> bool {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            return true;
        };
        name.starts_with('.') || matches!(name, "runs" | "report" | "target" | "node_modules")
    }

    let mut folders = Vec::new();
    collect(root, &mut folders, 0);
    if folders.is_empty() {
        folders.push(root.to_owned());
    }
    // Canonical form is what the store holds, so already-registered folders
    // compare equal however the user navigated to them.
    folders
        .into_iter()
        .map(|path| std::fs::canonicalize(&path).unwrap_or(path))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::fold_home;
    use std::path::Path;

    #[test]
    fn folds_only_what_lives_under_home() {
        let home = Path::new("/Users/wenke");

        assert_eq!(
            fold_home(Path::new("/Users/wenke/projects/coco/mock"), Some(home)),
            "~/projects/coco/mock"
        );
        assert_eq!(fold_home(home, Some(home)), "~");

        // A cluster path is not under home and stays as it is.
        assert_eq!(
            fold_home(Path::new("/scratch/wenke/sweep"), Some(home)),
            "/scratch/wenke/sweep"
        );

        // Textually `/Users/wenke2` starts with `/Users/wenke`, and is someone
        // else's home.
        assert_eq!(
            fold_home(Path::new("/Users/wenke2/sweep"), Some(home)),
            "/Users/wenke2/sweep"
        );

        // No home to fold against.
        assert_eq!(
            fold_home(Path::new("/Users/wenke/sweep"), None),
            "/Users/wenke/sweep"
        );
    }
}
