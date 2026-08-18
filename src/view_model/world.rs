//! The whole view model at one instant (specification §26.1).
//!
//! [`World`] holds every fact a screen can show; [`Snapshot`] is a cheap handle
//! to one. The UI never mutates either — every change goes through a backend
//! command, and the next snapshot shows the result.
//!
//! Snapshots are `Arc` clones, so taking one every frame is free and no report
//! text is ever copied. That contract exists for the render loop, and it is the
//! only place the UI's needs reach into this model's shape.

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::{DateTime, Local};
use serde::Serialize;

use super::{
    BenchProgress, BenchRun, Entity, EntityId, EntityKind, JobRun, RunId, RunStatus, progress_of,
};

#[derive(Clone, Debug, Default, Serialize)]
pub struct World {
    /// Explorer order is decided here, once, rather than re-sorted every frame.
    pub entities: Vec<Entity>,
    pub job_runs: BTreeMap<RunId, JobRun>,
    pub bench_runs: BTreeMap<RunId, BenchRun>,
    /// Run ids per Job, oldest first. Maintained on insert so the UI never has
    /// to scan or sort the whole run map (specification §35).
    pub runs_by_job: BTreeMap<EntityId, Vec<RunId>>,
    /// Bench run ids per Bench, oldest first.
    pub runs_by_bench: BTreeMap<EntityId, Vec<RunId>>,
    pub last_refresh: Option<DateTime<Local>>,
}

impl World {
    /// Record a Job run in its Job's index, keeping the index sorted by start
    /// time.
    ///
    /// Insertion order is *not* chronological order — a Bench dispatches
    /// children long after older history was seeded, and bulk fixtures backdate
    /// their rows. Sorting here, once per insert, keeps every read O(1) and
    /// avoids re-sorting a 500-row history every frame (specification §35).
    pub fn index_job_run(&mut self, id: RunId) {
        let Some(run) = self.job_runs.get(&id) else {
            return;
        };
        let (job_id, started_at) = (run.job_id.clone(), run.started_at);

        let position = match self.runs_by_job.get(&job_id) {
            Some(existing) => existing.partition_point(|other| {
                self.job_runs
                    .get(other)
                    .is_some_and(|run| run.started_at <= started_at)
            }),
            None => 0,
        };

        self.runs_by_job
            .entry(job_id)
            .or_default()
            .insert(position, id);
    }

    /// As [`Self::index_job_run`], for Bench runs.
    pub fn index_bench_run(&mut self, id: RunId) {
        let Some(run) = self.bench_runs.get(&id) else {
            return;
        };
        let (bench_id, started_at) = (run.bench_id.clone(), run.started_at);

        let position = match self.runs_by_bench.get(&bench_id) {
            Some(existing) => existing.partition_point(|other| {
                self.bench_runs
                    .get(other)
                    .is_some_and(|run| run.started_at <= started_at)
            }),
            None => 0,
        };

        self.runs_by_bench
            .entry(bench_id)
            .or_default()
            .insert(position, id);
    }

    pub fn entity(&self, id: &EntityId) -> Option<&Entity> {
        self.entities.iter().find(|entity| &entity.id == id)
    }

    pub fn entity_name(&self, id: &EntityId) -> &str {
        self.entity(id).map_or("(removed)", |entity| &entity.name)
    }

    pub fn job_run(&self, id: &RunId) -> Option<&JobRun> {
        self.job_runs.get(id)
    }

    pub fn bench_run(&self, id: &RunId) -> Option<&BenchRun> {
        self.bench_runs.get(id)
    }

    pub fn entities_of_kind(&self, kind: EntityKind) -> impl Iterator<Item = &Entity> {
        self.entities.iter().filter(move |e| e.kind == kind)
    }

    /// A Job's complete history, newest first.
    ///
    /// This includes runs a Bench dispatched. They are ordinary history rows and
    /// are never hidden (specification §13.3).
    pub fn job_history(&self, job_id: &EntityId) -> impl Iterator<Item = &JobRun> {
        self.runs_by_job
            .get(job_id)
            .into_iter()
            .flat_map(|ids| ids.iter().rev())
            .filter_map(|id| self.job_runs.get(id))
    }

    /// A Bench's run history, newest first.
    pub fn bench_history(&self, bench_id: &EntityId) -> impl Iterator<Item = &BenchRun> {
        self.runs_by_bench
            .get(bench_id)
            .into_iter()
            .flat_map(|ids| ids.iter().rev())
            .filter_map(|id| self.bench_runs.get(id))
    }

    /// Statuses of every run a Bench run dispatched, in plan order.
    pub fn child_statuses(&self, bench_run: &BenchRun) -> Vec<RunStatus> {
        bench_run
            .plan
            .steps
            .iter()
            .filter_map(|step| self.job_runs.get(&step.run_id))
            .map(|run| run.status)
            .collect()
    }

    pub fn bench_progress(&self, bench_run: &BenchRun) -> BenchProgress {
        progress_of(&self.child_statuses(bench_run))
    }

    /// Every active run, across every Job.
    pub fn active_job_runs(&self) -> impl Iterator<Item = &JobRun> {
        self.job_runs.values().filter(|run| run.status.is_active())
    }

    /// Active runs of one Job, newest first.
    pub fn active_runs_of(&self, job_id: &EntityId) -> impl Iterator<Item = &JobRun> {
        self.job_history(job_id)
            .filter(|run| run.status.is_active())
    }

    pub fn active_bench_runs_of(&self, bench_id: &EntityId) -> impl Iterator<Item = &BenchRun> {
        self.bench_history(bench_id)
            .filter(|run| run.status.is_active())
    }

    /// Top-bar count. Bench runs are counted once, not once per dispatched child,
    /// so that a 50-call sweep reads as one thing the user started.
    pub fn active_run_count(&self) -> usize {
        let direct = self
            .job_runs
            .values()
            .filter(|run| run.status.is_active() && run.origin.is_direct())
            .count();
        let benches = self
            .bench_runs
            .values()
            .filter(|run| run.status.is_active())
            .count();
        direct + benches
    }

    /// Whether any active run has lost query contact (specification §8.5).
    pub fn has_query_interruption(&self) -> bool {
        self.active_job_runs()
            .any(|run| !run.query_health.is_available())
    }
}

/// What [`crate::adapter::Experiments::snapshot`] hands the UI.
#[derive(Clone, Debug, Default)]
pub struct Snapshot {
    world: Arc<World>,
}

impl Snapshot {
    pub fn new(world: Arc<World>) -> Self {
        Self { world }
    }
}

impl std::ops::Deref for Snapshot {
    type Target = World;

    fn deref(&self) -> &World {
        &self.world
    }
}
