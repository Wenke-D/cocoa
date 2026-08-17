//! Deterministic mock backend.
//!
//! Synchronous, no async runtime, no randomness, no clock of its own — time
//! enters only through [`ExperimentBackend::tick`], so tests advance the world
//! by hand and get identical results every run.
//!
//! Nothing here executes a process, reads a manifest, or touches the filesystem.

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::{DateTime, Local, TimeDelta};

use crate::backend::snapshot::{BackendSnapshot, World};
use crate::backend::traits::{
    BackendError, CancelTarget, DemoEntityKind, ExperimentBackend, PrototypeBackend,
};
use crate::fixtures::demo::{self, PlanCall, PlanTemplate, derive_parameters, run_id};
use crate::fixtures::reports::{ReportKind, ReportLibrary};
use crate::model::{
    BenchPlan, BenchPlanStep, BenchRun, Entity, EntityId, EntityKind, JobRun, ManifestState,
    QueryHealth, ReportState, RunId, RunOrigin, RunStatus, aggregate_status,
};

const STARTING_FOR: TimeDelta = TimeDelta::seconds(2);
const CANCELLING_FOR: TimeDelta = TimeDelta::seconds(2);
const REPORT_DELAY: TimeDelta = TimeDelta::seconds(3);

/// What a mock run will do next, and when.
#[derive(Clone, Debug)]
struct Schedule {
    next_transition_at: Option<DateTime<Local>>,
    running_for: TimeDelta,
    /// The terminal status this run is heading for.
    outcome: RunStatus,
    /// What the report becomes once generation finishes.
    report_result: ReportState,
}

impl Schedule {
    /// Durations vary with the run's sequence number so that a Bench's children
    /// finish out of order, as §27.2 requires.
    fn for_seq(seq: u64, reports: &ReportLibrary) -> Self {
        Self {
            next_transition_at: None,
            running_for: TimeDelta::seconds(8 + (seq % 5) as i64 * 4),
            outcome: RunStatus::Succeeded,
            report_result: reports.state(ReportKind::JobSuccess),
        }
    }

    fn report_only(at: DateTime<Local>, result: ReportState) -> Self {
        Self {
            next_transition_at: Some(at),
            running_for: TimeDelta::zero(),
            outcome: RunStatus::Succeeded,
            report_result: result,
        }
    }
}

pub struct MockBackend {
    world: Arc<World>,
    plans: BTreeMap<EntityId, PlanTemplate>,
    reports: ReportLibrary,
    schedules: BTreeMap<RunId, Schedule>,
    /// Simulated clock. Advanced only by `tick`.
    now: DateTime<Local>,
    next_seq: u64,
    auto_progress: bool,
    simulate_start_failure: bool,
    simulate_cancel_failure: bool,
    /// Counter for fabricated Add Folder entities.
    demo_seq: u64,
}

impl MockBackend {
    pub fn new(now: DateTime<Local>) -> Self {
        let reports = ReportLibrary::new();
        let fixtures = demo::build(now, &reports);

        let mut backend = Self {
            world: Arc::new(fixtures.world),
            plans: fixtures.plans,
            reports,
            schedules: BTreeMap::new(),
            now,
            next_seq: fixtures.next_seq,
            auto_progress: true,
            simulate_start_failure: false,
            simulate_cancel_failure: false,
            demo_seq: 0,
        };
        backend.schedule_existing_active_runs(now);
        backend
    }

    fn world_mut(&mut self) -> &mut World {
        Arc::make_mut(&mut self.world)
    }

    fn allocate_run_id(&mut self) -> (RunId, u64) {
        let seq = self.next_seq;
        self.next_seq += 1;
        (run_id(seq), seq)
    }

    /// Give the fixture's already-active runs somewhere to go.
    fn schedule_existing_active_runs(&mut self, now: DateTime<Local>) {
        let active: Vec<(RunId, RunStatus)> = self
            .world
            .job_runs
            .values()
            .filter(|run| run.status.is_active())
            .map(|run| (run.id.clone(), run.status))
            .collect();

        for (id, status) in active {
            let seq = seq_of(&id);
            let mut schedule = Schedule::for_seq(seq, &self.reports);
            schedule.next_transition_at = Some(match status {
                RunStatus::Starting => now + STARTING_FOR,
                RunStatus::Cancelling => now + CANCELLING_FOR,
                _ => now + schedule.running_for,
            });
            self.schedules.insert(id, schedule);
        }
    }

    // ---------------------------------------------------------------- starting

    fn check_startable(&self, entity: &Entity, parameters: &str) -> Result<(), BackendError> {
        if let Some(reason) = entity.manifest.blocking_reason() {
            return Err(BackendError::ManifestUnusable {
                entity: entity.name.clone(),
                reason,
            });
        }
        if entity.parameters_required && parameters.trim().is_empty() {
            return Err(BackendError::ParametersRequired);
        }
        if self.simulate_start_failure {
            return Err(BackendError::Simulated(
                "The start operation defined by the manifest exited with code 1.".to_owned(),
            ));
        }
        Ok(())
    }

    fn start_job(&mut self, job_id: &EntityId, parameters: String, origin: RunOrigin) -> RunId {
        let (id, seq) = self.allocate_run_id();
        let now = self.now;

        let run = JobRun {
            id: id.clone(),
            job_id: job_id.clone(),
            origin,
            started_at: now,
            ended_at: None,
            parameters,
            status: RunStatus::Starting,
            query_health: QueryHealth::Healthy,
            last_successful_query: now,
            report: ReportState::Unavailable,
            error: None,
        };

        let mut schedule = Schedule::for_seq(seq, &self.reports);
        schedule.next_transition_at = Some(now + STARTING_FOR);
        self.schedules.insert(id.clone(), schedule);

        let world = self.world_mut();
        world.job_runs.insert(id.clone(), run);
        world.index_job_run(id.clone());

        id
    }

    /// Fan a Bench out across existing Jobs.
    ///
    /// The plan is produced in full, validated in full, and only then
    /// dispatched. A partial plan is never dispatched (specification §2.3.2).
    fn start_bench(
        &mut self,
        bench_id: &EntityId,
        parameters: String,
    ) -> Result<RunId, BackendError> {
        let template = self.plans.get(bench_id).cloned().unwrap_or_default();
        if template.calls.is_empty() {
            return Err(BackendError::Simulated(
                "This Bench returned no calls.".to_owned(),
            ));
        }

        // Validate every call before creating anything.
        for (index, call) in template.calls.iter().enumerate() {
            let call_index = index + 1;
            let Some(target) = self.world.entity(&call.job_id) else {
                return Err(BackendError::InvalidPlan {
                    call_index,
                    job: call.job_id.to_string(),
                    reason: "it is not in the Library".to_owned(),
                });
            };
            if !target.is_job() {
                return Err(BackendError::InvalidPlan {
                    call_index,
                    job: target.name.clone(),
                    reason: "it is a Bench, not a Job".to_owned(),
                });
            }
            if let Some(reason) = target.manifest.blocking_reason() {
                return Err(BackendError::InvalidPlan {
                    call_index,
                    job: target.name.clone(),
                    reason,
                });
            }
        }

        let (bench_run_id, _) = self.allocate_run_id();
        let now = self.now;

        // Dispatch everything at once. Nothing waits for anything else.
        let mut steps = Vec::with_capacity(template.calls.len());
        for (index, call) in template.calls.iter().enumerate() {
            let call_parameters = derive_parameters(&parameters, &call.parameter_suffix);
            let child_id = self.start_job(
                &call.job_id,
                call_parameters.clone(),
                RunOrigin::BenchStep {
                    bench_id: bench_id.clone(),
                    bench_run_id: bench_run_id.clone(),
                    step_index: index + 1,
                },
            );
            steps.push(BenchPlanStep {
                index: index + 1,
                job_id: call.job_id.clone(),
                parameters: call_parameters,
                run_id: child_id,
            });
        }

        let bench_run = BenchRun {
            id: bench_run_id.clone(),
            bench_id: bench_id.clone(),
            started_at: now,
            ended_at: None,
            parameters,
            plan: BenchPlan { steps },
            status: RunStatus::Starting,
            query_health: QueryHealth::Healthy,
            last_successful_query: now,
            report: ReportState::Unavailable,
            error: None,
        };

        let world = self.world_mut();
        world.bench_runs.insert(bench_run_id.clone(), bench_run);
        world.index_bench_run(bench_run_id.clone());

        self.recompute_bench_runs();
        Ok(bench_run_id)
    }

    // -------------------------------------------------------------- progressing

    /// Apply one mock transition to a run.
    fn transition(&mut self, id: &RunId, now: DateTime<Local>) {
        // Bench runs only ever transition their report; their status is derived.
        if self.world.bench_runs.contains_key(id) {
            let result = self.schedules.get(id).map(|s| s.report_result.clone());
            if let Some(result) = result {
                let world = self.world_mut();
                if let Some(bench_run) = world.bench_runs.get_mut(id)
                    && bench_run.report == ReportState::Generating
                {
                    bench_run.report = result;
                }
            }
            self.schedules.remove(id);
            return;
        }

        let Some(schedule) = self.schedules.get(id).cloned() else {
            return;
        };
        let Some(run) = self.world.job_runs.get(id) else {
            self.schedules.remove(id);
            return;
        };

        let status = run.status;
        let report_is_generating = run.report == ReportState::Generating;
        let reports = self.reports.clone();
        let world = self.world_mut();
        let Some(run) = world.job_runs.get_mut(id) else {
            return;
        };

        let mut next: Option<DateTime<Local>> = None;

        match status {
            RunStatus::Starting | RunStatus::Pending => {
                run.status = RunStatus::Running;
                run.last_successful_query = now;
                next = Some(now + schedule.running_for);
            }
            RunStatus::Running => {
                run.status = schedule.outcome;
                run.ended_at = Some(now);
                run.last_successful_query = now;
                if schedule.outcome == RunStatus::Failed {
                    run.error = Some("The Job reported a failed execution state.".to_owned());
                }
                run.report = ReportState::Generating;
                next = Some(now + REPORT_DELAY);
            }
            RunStatus::Cancelling => {
                run.status = RunStatus::Cancelled;
                run.ended_at = Some(now);
                run.last_successful_query = now;
            }
            _ if report_is_generating => {
                run.report = if schedule.outcome == RunStatus::Failed {
                    reports.state(ReportKind::JobFailure)
                } else {
                    schedule.report_result.clone()
                };
            }
            _ => {}
        }

        match next {
            Some(at) => {
                if let Some(entry) = self.schedules.get_mut(id) {
                    entry.next_transition_at = Some(at);
                }
            }
            None => {
                // Keep the entry only while a report is still pending.
                let still_pending = self
                    .world
                    .job_runs
                    .get(id)
                    .is_some_and(|run| run.report == ReportState::Generating);
                if still_pending {
                    if let Some(entry) = self.schedules.get_mut(id) {
                        entry.next_transition_at = Some(now + REPORT_DELAY);
                    }
                } else {
                    self.schedules.remove(id);
                }
            }
        }

        self.recompute_bench_runs();
    }

    /// Re-derive every Bench run's status from its children.
    ///
    /// This is the only place a Bench run's status is written.
    fn recompute_bench_runs(&mut self) {
        let now = self.now;
        let bench_summary = self.reports.state(ReportKind::BenchSummary);
        let ids: Vec<RunId> = self.world.bench_runs.keys().cloned().collect();
        let mut newly_terminal: Vec<RunId> = Vec::new();

        let world = self.world_mut();
        for id in ids {
            let (statuses, latest_end) = {
                let Some(bench_run) = world.bench_runs.get(&id) else {
                    continue;
                };
                let children: Vec<&JobRun> = bench_run
                    .plan
                    .steps
                    .iter()
                    .filter_map(|step| world.job_runs.get(&step.run_id))
                    .collect();
                let statuses: Vec<RunStatus> = children.iter().map(|run| run.status).collect();
                let latest_end = children.iter().filter_map(|run| run.ended_at).max();
                (statuses, latest_end)
            };

            let status = aggregate_status(&statuses);
            let Some(bench_run) = world.bench_runs.get_mut(&id) else {
                continue;
            };

            let was_active = bench_run.status.is_active();
            bench_run.status = status;

            if status.is_terminal() {
                if bench_run.ended_at.is_none() {
                    bench_run.ended_at = latest_end.or(Some(now));
                }
                if was_active && bench_run.report == ReportState::Unavailable {
                    bench_run.report = ReportState::Generating;
                    newly_terminal.push(id.clone());
                }
            } else {
                bench_run.ended_at = None;
            }
        }

        for id in newly_terminal {
            self.schedules.insert(
                id,
                Schedule::report_only(now + REPORT_DELAY, bench_summary.clone()),
            );
        }
    }

    // ----------------------------------------------------------- mock controls
    //
    // Prototype-only. These are not production operations and must never be
    // presented as such in the UI (specification §28).

    pub fn auto_progress(&self) -> bool {
        self.auto_progress
    }

    pub fn set_auto_progress(&mut self, enabled: bool) {
        self.auto_progress = enabled;
    }

    pub fn set_simulate_start_failure(&mut self, enabled: bool) {
        self.simulate_start_failure = enabled;
    }

    pub fn set_simulate_cancel_failure(&mut self, enabled: bool) {
        self.simulate_cancel_failure = enabled;
    }

    /// Force a run's next transition immediately.
    pub fn advance_run(&mut self, id: &RunId) {
        let now = self.now;
        self.transition(id, now);
    }

    /// Jump a run straight to a terminal status.
    pub fn finish_run(&mut self, id: &RunId, outcome: RunStatus) {
        if !outcome.is_terminal() {
            return;
        }
        let now = self.now;
        let report = match outcome {
            RunStatus::Failed => self.reports.state(ReportKind::JobFailure),
            _ => self.reports.state(ReportKind::JobSuccess),
        };

        let world = self.world_mut();
        if let Some(run) = world.job_runs.get_mut(id) {
            run.status = outcome;
            run.ended_at = Some(now);
            run.last_successful_query = now;
            run.report = ReportState::Generating;
            run.error = (outcome == RunStatus::Failed)
                .then(|| "The Job reported a failed execution state.".to_owned());
        } else {
            return;
        }

        let mut schedule = Schedule::report_only(now + REPORT_DELAY, report);
        schedule.outcome = outcome;
        self.schedules.insert(id.clone(), schedule);
        self.recompute_bench_runs();
    }

    /// Toggle simulated loss of query contact.
    ///
    /// This must never change the execution status: the run keeps doing whatever
    /// it was doing, we simply stop being able to see it (specification §31).
    pub fn toggle_query_unavailable(&mut self, id: &RunId) {
        let world = self.world_mut();
        if let Some(run) = world.job_runs.get_mut(id) {
            run.query_health = if run.query_health.is_available() {
                QueryHealth::Unavailable {
                    message: "the status command did not respond".to_owned(),
                }
            } else {
                QueryHealth::Healthy
            };
        }
    }

    pub fn set_report(&mut self, id: &RunId, state: ReportState) {
        let world = self.world_mut();
        if let Some(run) = world.job_runs.get_mut(id) {
            run.report = state;
        } else if let Some(bench_run) = world.bench_runs.get_mut(id) {
            bench_run.report = state;
        }
    }

    pub fn generate_report(&mut self, id: &RunId) {
        let state = self.reports.state(ReportKind::JobSuccess);
        self.set_report(id, state);
    }

    pub fn remove_report(&mut self, id: &RunId) {
        self.set_report(id, ReportState::Missing);
    }

    /// Bulk history for the performance requirement in §22.5.
    pub fn generate_history(&mut self, job_id: &EntityId, count: usize) {
        let base = self.now;
        let reports = self.reports.clone();
        for i in 0..count {
            let (id, seq) = self.allocate_run_id();
            let started_at = base - TimeDelta::minutes((count - i) as i64 * 7);
            let ran_for = TimeDelta::seconds(60 + (seq % 17) as i64 * 31);
            let status = match seq % 5 {
                0 => RunStatus::Failed,
                1 => RunStatus::Cancelled,
                _ => RunStatus::Succeeded,
            };
            let report = match status {
                RunStatus::Failed => reports.state(ReportKind::JobFailure),
                RunStatus::Cancelled => ReportState::Unavailable,
                _ => reports.state(ReportKind::JobSuccess),
            };

            let run = JobRun {
                id: id.clone(),
                job_id: job_id.clone(),
                origin: RunOrigin::Direct,
                started_at,
                ended_at: Some(started_at + ran_for),
                parameters: format!("--mesh={} --gpu=0 --seed={seq}", 64 << (seq % 5)),
                status,
                query_health: QueryHealth::Healthy,
                last_successful_query: started_at + ran_for,
                report,
                error: (status == RunStatus::Failed)
                    .then(|| "The Job reported a failed execution state.".to_owned()),
            };

            let world = self.world_mut();
            world.job_runs.insert(id.clone(), run);
            world.index_job_run(id);
        }
    }

    /// Rebuild the demo Library from scratch.
    pub fn reset(&mut self, now: DateTime<Local>) {
        *self = Self::new(now);
    }

    /// Insert a fabricated entity, standing in for the Add Folder flow
    /// (specification §11.5). Reads no filesystem.
    pub fn insert_entity(&mut self, entity: Entity, plan: Option<PlanTemplate>) {
        if let Some(plan) = plan {
            self.plans.insert(entity.id.clone(), plan);
        }
        let world = self.world_mut();
        if world.entity(&entity.id).is_none() {
            world.entities.push(entity);
        }
    }
}

impl PrototypeBackend for MockBackend {
    fn add_demo_entity(&mut self, kind: DemoEntityKind) {
        self.demo_seq += 1;
        let n = self.demo_seq;

        let (entity, plan) = match kind {
            DemoEntityKind::Job => (
                Entity {
                    id: EntityId::new(format!("demo-job-{n}")),
                    kind: EntityKind::Job,
                    name: format!("Demo Job {n}"),
                    path: format!("~/Experiments/demo-job-{n}"),
                    manifest: ManifestState::Valid,
                    default_parameters: "--demo".to_owned(),
                    last_used_parameters: None,
                    parameters_required: false,
                },
                None,
            ),

            DemoEntityKind::Bench => {
                // A Bench references Jobs that already exist. It never defines
                // its own (specification §2.2).
                let targets: Vec<EntityId> = self
                    .world
                    .entities_of_kind(EntityKind::Job)
                    .filter(|job| job.manifest.is_valid())
                    .take(2)
                    .map(|job| job.id.clone())
                    .collect();

                let calls = targets
                    .into_iter()
                    .map(|job_id| PlanCall {
                        job_id,
                        parameter_suffix: "--demo".to_owned(),
                    })
                    .collect();

                (
                    Entity {
                        id: EntityId::new(format!("demo-bench-{n}")),
                        kind: EntityKind::Bench,
                        name: format!("Demo Bench {n}"),
                        path: format!("~/Experiments/demo-bench-{n}"),
                        manifest: ManifestState::Valid,
                        default_parameters: String::new(),
                        last_used_parameters: None,
                        parameters_required: false,
                    },
                    Some(PlanTemplate { calls }),
                )
            }

            DemoEntityKind::InvalidManifest => (
                Entity {
                    id: EntityId::new(format!("demo-invalid-{n}")),
                    kind: EntityKind::Job,
                    name: format!("Invalid Experiment {n}"),
                    path: format!("~/Experiments/demo-invalid-{n}"),
                    manifest: ManifestState::Invalid {
                        message: "unrecognised manifest version".to_owned(),
                    },
                    default_parameters: String::new(),
                    last_used_parameters: None,
                    parameters_required: false,
                },
                None,
            ),
        };

        self.insert_entity(entity, plan);
    }

    fn is_auto_progressing(&self) -> bool {
        self.auto_progress
    }

    fn set_auto_progressing(&mut self, enabled: bool) {
        self.auto_progress = enabled;
    }

    fn advance(&mut self, run_id: &RunId) {
        self.advance_run(run_id);
    }

    fn finish(&mut self, run_id: &RunId, outcome: RunStatus) {
        self.finish_run(run_id, outcome);
    }

    fn toggle_query_unavailable(&mut self, run_id: &RunId) {
        MockBackend::toggle_query_unavailable(self, run_id);
    }

    fn make_report_available(&mut self, run_id: &RunId) {
        self.generate_report(run_id);
    }

    fn make_report_missing(&mut self, run_id: &RunId) {
        self.remove_report(run_id);
    }

    fn generate_history(&mut self, job_id: &EntityId, count: usize) {
        MockBackend::generate_history(self, job_id, count);
    }

    fn reset(&mut self, now: DateTime<Local>) {
        MockBackend::reset(self, now);
    }
}

/// Recover the allocation sequence from a run id, so schedules stay deterministic.
fn seq_of(id: &RunId) -> u64 {
    id.as_str()
        .rsplit('-')
        .next()
        .and_then(|digits| digits.parse().ok())
        .unwrap_or(0)
}

impl ExperimentBackend for MockBackend {
    fn snapshot(&self) -> BackendSnapshot {
        BackendSnapshot::new(Arc::clone(&self.world))
    }

    fn start(&mut self, entity_id: &EntityId, parameters: String) -> Result<RunId, BackendError> {
        let Some(entity) = self.world.entity(entity_id) else {
            return Err(BackendError::UnknownEntity(entity_id.clone()));
        };
        let entity = entity.clone();
        self.check_startable(&entity, &parameters)?;

        let result = if entity.is_bench() {
            self.start_bench(entity_id, parameters.clone())
        } else {
            Ok(self.start_job(entity_id, parameters.clone(), RunOrigin::Direct))
        };

        if result.is_ok() {
            let world = self.world_mut();
            if let Some(entity) = world.entities.iter_mut().find(|e| &e.id == entity_id) {
                entity.last_used_parameters = Some(parameters);
            }
        }

        result
    }

    fn cancel(&mut self, target: CancelTarget) -> Result<(), BackendError> {
        let now = self.now;

        // Collect the runs to cancel before mutating anything.
        let victims: Vec<RunId> = match &target {
            CancelTarget::JobRun(id) => {
                let Some(run) = self.world.job_runs.get(id) else {
                    return Err(BackendError::UnknownRun(id.clone()));
                };
                if !run.status.is_cancellable() {
                    return Err(BackendError::NotCancellable {
                        reason: format!("this run is already {}.", run.status.label()),
                    });
                }
                vec![id.clone()]
            }
            CancelTarget::BenchRun(id) => {
                let Some(bench_run) = self.world.bench_runs.get(id) else {
                    return Err(BackendError::UnknownRun(id.clone()));
                };
                let active: Vec<RunId> = bench_run
                    .plan
                    .steps
                    .iter()
                    .filter(|step| {
                        self.world
                            .job_runs
                            .get(&step.run_id)
                            .is_some_and(|run| run.status.is_cancellable())
                    })
                    .map(|step| step.run_id.clone())
                    .collect();
                if active.is_empty() {
                    return Err(BackendError::NotCancellable {
                        reason: "no run dispatched by this Bench is still active.".to_owned(),
                    });
                }
                active
            }
        };

        if self.simulate_cancel_failure {
            // Leave every status exactly as it was (specification §31).
            return Err(BackendError::Simulated(
                "The cancellation operation defined by the manifest could not be reached."
                    .to_owned(),
            ));
        }

        for id in &victims {
            let world = self.world_mut();
            if let Some(run) = world.job_runs.get_mut(id) {
                run.status = RunStatus::Cancelling;
            }
            if let Some(entry) = self.schedules.get_mut(id) {
                entry.next_transition_at = Some(now + CANCELLING_FOR);
            } else {
                let mut schedule = Schedule::for_seq(seq_of(id), &self.reports);
                schedule.next_transition_at = Some(now + CANCELLING_FOR);
                self.schedules.insert(id.clone(), schedule);
            }
        }

        self.recompute_bench_runs();
        Ok(())
    }

    fn refresh(&mut self) -> Result<(), BackendError> {
        let now = self.now;
        let world = self.world_mut();
        world.last_refresh = Some(now);
        for run in world.job_runs.values_mut() {
            if run.status.is_active() && run.query_health.is_available() {
                run.last_successful_query = now;
            }
        }
        Ok(())
    }

    fn report(&self, run_id: &RunId) -> Result<ReportState, BackendError> {
        self.world
            .job_runs
            .get(run_id)
            .map(|run| &run.report)
            .or_else(|| self.world.bench_runs.get(run_id).map(|run| &run.report))
            .cloned()
            .ok_or_else(|| BackendError::UnknownRun(run_id.clone()))
    }

    fn tick(&mut self, now: DateTime<Local>) {
        self.now = now;

        {
            let world = self.world_mut();
            world.last_refresh = Some(now);
            for run in world.job_runs.values_mut() {
                if run.status.is_active() && run.query_health.is_available() {
                    run.last_successful_query = now;
                }
            }
        }

        if !self.auto_progress {
            return;
        }

        // A run we cannot query does not visibly change (specification §31).
        let due: Vec<RunId> = self
            .schedules
            .iter()
            .filter(|(_, schedule)| schedule.next_transition_at.is_some_and(|at| at <= now))
            .map(|(id, _)| id.clone())
            .filter(|id| {
                self.world
                    .job_runs
                    .get(id)
                    .is_none_or(|run| run.query_health.is_available())
            })
            .collect();

        for id in due {
            self.transition(&id, now);
        }

        self.recompute_bench_runs();
    }
}
