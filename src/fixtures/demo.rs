//! Deterministic demo Library (specification §29).
//!
//! Everything here is fabricated. No filesystem is read and no manifest is
//! parsed. Timestamps are derived from a caller-supplied `now` so the fixtures
//! are reproducible.

use std::collections::BTreeMap;

use chrono::{DateTime, Local, TimeDelta};

use crate::backend::snapshot::World;
use crate::fixtures::reports::{ReportKind, ReportLibrary};
use crate::model::{
    BenchPlan, BenchPlanStep, BenchRun, Entity, EntityId, EntityKind, JobRun, ManifestState,
    QueryHealth, ReportState, RunId, RunOrigin, RunStatus, aggregate_status,
};

/// One call a Bench plan will produce.
#[derive(Clone, Debug)]
pub struct PlanCall {
    pub job_id: EntityId,
    /// Appended to the Bench's own input string to form this call's parameters.
    pub parameter_suffix: String,
}

/// What a Bench returns when started.
///
/// This stands in for manifest logic. It lives in the fixtures, never in
/// [`Entity`] — a Bench does not own a job list (specification §2.2).
#[derive(Clone, Debug, Default)]
pub struct PlanTemplate {
    pub calls: Vec<PlanCall>,
}

pub struct Fixtures {
    pub world: World,
    pub plans: BTreeMap<EntityId, PlanTemplate>,
    /// Where runtime run-id allocation continues from.
    pub next_seq: u64,
}

pub fn run_id(seq: u64) -> RunId {
    RunId::new(format!("run-{seq:06}"))
}

fn job(id: &str, name: &str, default_parameters: &str) -> Entity {
    Entity {
        id: EntityId::new(id),
        kind: EntityKind::Job,
        name: name.to_owned(),
        path: format!("~/Experiments/{id}"),
        manifest: ManifestState::Valid,
        default_parameters: default_parameters.to_owned(),
        last_used_parameters: None,
        parameters_required: false,
    }
}

fn bench(id: &str, name: &str, default_parameters: &str) -> Entity {
    Entity {
        id: EntityId::new(id),
        kind: EntityKind::Bench,
        name: name.to_owned(),
        path: format!("~/Experiments/{id}"),
        manifest: ManifestState::Valid,
        default_parameters: default_parameters.to_owned(),
        last_used_parameters: None,
        parameters_required: false,
    }
}

fn call(job_id: &str, suffix: &str) -> PlanCall {
    PlanCall {
        job_id: EntityId::new(job_id),
        parameter_suffix: suffix.to_owned(),
    }
}

/// Build the demo Library.
pub fn build(now: DateTime<Local>, reports: &ReportLibrary) -> Fixtures {
    // Benches are listed before Jobs to match the sidebar's grouping.
    let entities = vec![
        bench(
            "nightly-benchmark",
            "Nightly Benchmark",
            "--dataset=nightly",
        ),
        bench("parameter-sweep", "Parameter Sweep", "--gpu=0"),
        bench("smoke-test", "Smoke Test", ""),
        bench("broken-plan", "Broken Plan Bench", ""),
        job("prepare-data", "Prepare Data", "--dataset=nightly"),
        job("build-solver", "Build Solver", "--release"),
        job("generate-mesh", "Generate Mesh", "--resolution=fine"),
        job("solver-gpu", "Solver GPU", "--mesh=256 --gpu=0"),
        job("solver-cpu", "Solver CPU", "--mesh=128 --threads=16"),
        job("post-process", "Post Process", "--all"),
        job("generate-report", "Generate Report", "--summary"),
        Entity {
            id: EntityId::new("invalid-job"),
            kind: EntityKind::Job,
            name: "Invalid Job Manifest".to_owned(),
            path: "~/Experiments/invalid-job".to_owned(),
            manifest: ManifestState::Invalid {
                message: "missing `start` command".to_owned(),
            },
            default_parameters: String::new(),
            last_used_parameters: None,
            parameters_required: false,
        },
    ];

    let mut world = World {
        entities,
        ..World::default()
    };

    // One Job that insists on parameters, to exercise §15.2.
    if let Some(entity) = world
        .entities
        .iter_mut()
        .find(|e| e.id.as_str() == "solver-cpu")
    {
        entity.parameters_required = true;
    }

    let mut plans = BTreeMap::new();

    // Distinct Jobs, dispatched together. The names are legacy vocabulary from
    // an earlier sequential design; nothing here is a stage.
    plans.insert(
        EntityId::new("nightly-benchmark"),
        PlanTemplate {
            calls: vec![
                call("prepare-data", ""),
                call("build-solver", "--release"),
                call("generate-mesh", "--resolution=fine"),
                call("solver-gpu", "--mesh=256 --gpu=0"),
                call("post-process", "--all"),
                call("generate-report", "--summary"),
            ],
        },
    );

    // The same Job many times with different parameters.
    plans.insert(
        EntityId::new("parameter-sweep"),
        PlanTemplate {
            calls: (0..5)
                .map(|i| call("solver-gpu", &format!("--mesh={}", 64 << i)))
                .collect(),
        },
    );

    plans.insert(
        EntityId::new("smoke-test"),
        PlanTemplate {
            calls: vec![
                call("prepare-data", "--quick"),
                call("solver-cpu", "--tiny"),
            ],
        },
    );

    // Always fails validation: it references a Job with an invalid manifest.
    plans.insert(
        EntityId::new("broken-plan"),
        PlanTemplate {
            calls: vec![
                call("prepare-data", ""),
                call("solver-cpu", "--tiny"),
                call("invalid-job", "--anything"),
            ],
        },
    );

    let mut seq = 0_u64;
    seed_history(&mut world, &mut seq, now, reports);
    seed_bench_runs(&mut world, &mut plans, &mut seq, now, reports);

    Fixtures {
        world,
        plans,
        next_seq: seq,
    }
}

#[allow(clippy::too_many_arguments)]
fn push_job_run(
    world: &mut World,
    seq: &mut u64,
    job_id: &str,
    origin: RunOrigin,
    started_at: DateTime<Local>,
    ran_for: Option<TimeDelta>,
    parameters: &str,
    status: RunStatus,
    report: ReportState,
) -> RunId {
    let id = run_id(*seq);
    *seq += 1;

    let ended_at = if status.is_terminal() {
        ran_for.map(|d| started_at + d)
    } else {
        None
    };

    let run = JobRun {
        id: id.clone(),
        job_id: EntityId::new(job_id),
        origin,
        started_at,
        ended_at,
        parameters: parameters.to_owned(),
        status,
        query_health: QueryHealth::Healthy,
        last_successful_query: ended_at.unwrap_or(started_at),
        report,
        error: match status {
            RunStatus::Failed => Some("The Job reported a failed execution state.".to_owned()),
            _ => None,
        },
    };

    world.job_runs.insert(id.clone(), run);
    world.index_job_run(id.clone());
    id
}

/// Direct runs covering every historical state listed in §29.
fn seed_history(world: &mut World, seq: &mut u64, now: DateTime<Local>, reports: &ReportLibrary) {
    let minutes = |m: i64| now - TimeDelta::minutes(m);

    // Older, completed runs of Solver GPU with a spread of report states.
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(600),
        Some(TimeDelta::seconds(378)),
        "--mesh=64 --gpu=0",
        RunStatus::Succeeded,
        reports.state(ReportKind::HtmlJobSuccess),
    );
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(520),
        Some(TimeDelta::seconds(41)),
        "--mesh=1024 --gpu=0",
        RunStatus::Failed,
        reports.state(ReportKind::HtmlJobFailure),
    );
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(480),
        Some(TimeDelta::seconds(95)),
        "--mesh=256 --gpu=1",
        RunStatus::Cancelled,
        ReportState::Unavailable,
    );
    // A succeeded run whose report never materialised.
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(440),
        Some(TimeDelta::seconds(302)),
        "--mesh=128 --gpu=0",
        RunStatus::Succeeded,
        ReportState::Missing,
    );
    // A succeeded run whose report cannot be read.
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(400),
        Some(TimeDelta::seconds(288)),
        "--mesh=128 --gpu=1",
        RunStatus::Succeeded,
        ReportState::ReadError {
            message: "permission denied".to_owned(),
        },
    );
    // A long report and a search-heavy report, for the report viewer.
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(360),
        Some(TimeDelta::seconds(1811)),
        "--mesh=512 --gpu=0 --trace",
        RunStatus::Succeeded,
        reports.state(ReportKind::Long),
    );
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(320),
        Some(TimeDelta::seconds(640)),
        "--mesh=256 --gpu=0 --dump-field",
        RunStatus::Succeeded,
        reports.state(ReportKind::LongLines),
    );
    push_job_run(
        world,
        seq,
        "solver-cpu",
        RunOrigin::Direct,
        minutes(300),
        Some(TimeDelta::seconds(722)),
        "--mesh=128 --threads=16",
        RunStatus::Succeeded,
        reports.state(ReportKind::Searchable),
    );
    // A succeeded run still generating its report.
    push_job_run(
        world,
        seq,
        "post-process",
        RunOrigin::Direct,
        minutes(12),
        Some(TimeDelta::seconds(64)),
        "--all",
        RunStatus::Succeeded,
        ReportState::Generating,
    );

    // Active direct runs: one healthy, one that has lost query contact, one
    // still starting, one being cancelled.
    push_job_run(
        world,
        seq,
        "solver-gpu",
        RunOrigin::Direct,
        minutes(6),
        None,
        "--mesh=256 --gpu=0",
        RunStatus::Running,
        ReportState::Unavailable,
    );

    let stale = push_job_run(
        world,
        seq,
        "solver-cpu",
        RunOrigin::Direct,
        minutes(9),
        None,
        "--mesh=256 --threads=32",
        RunStatus::Running,
        ReportState::Unavailable,
    );
    if let Some(run) = world.job_runs.get_mut(&stale) {
        run.query_health = QueryHealth::Unavailable {
            message: "the status command did not respond".to_owned(),
        };
        run.last_successful_query = now - TimeDelta::seconds(38);
    }

    push_job_run(
        world,
        seq,
        "generate-mesh",
        RunOrigin::Direct,
        now - TimeDelta::seconds(3),
        None,
        "--resolution=coarse",
        RunStatus::Starting,
        ReportState::Unavailable,
    );

    push_job_run(
        world,
        seq,
        "prepare-data",
        RunOrigin::Direct,
        minutes(4),
        None,
        "--dataset=scratch",
        RunStatus::Cancelling,
        ReportState::Unavailable,
    );
}

/// Historical Bench runs. Their children are ordinary Job runs and appear in
/// their Jobs' histories (specification §2.3.1).
fn seed_bench_runs(
    world: &mut World,
    plans: &mut BTreeMap<EntityId, PlanTemplate>,
    seq: &mut u64,
    now: DateTime<Local>,
    reports: &ReportLibrary,
) {
    // A finished Nightly Benchmark run: five succeeded, one failed. The failure
    // did not stop its siblings.
    let started = now - TimeDelta::minutes(180);
    let outcomes = [
        (RunStatus::Succeeded, 72_i64),
        (RunStatus::Succeeded, 225),
        (RunStatus::Succeeded, 138),
        (RunStatus::Succeeded, 391),
        (RunStatus::Failed, 7),
        (RunStatus::Succeeded, 44),
    ];
    seed_bench_run(
        world,
        plans,
        seq,
        "nightly-benchmark",
        "--dataset=nightly",
        started,
        &outcomes,
        reports.state(ReportKind::BenchSummary),
        reports,
    );

    // An in-flight Parameter Sweep: two finished, three still running.
    let started = now - TimeDelta::minutes(8);
    let outcomes = [
        (RunStatus::Succeeded, 96_i64),
        (RunStatus::Succeeded, 184),
        (RunStatus::Running, 0),
        (RunStatus::Running, 0),
        (RunStatus::Running, 0),
    ];
    seed_bench_run(
        world,
        plans,
        seq,
        "parameter-sweep",
        "--gpu=0",
        started,
        &outcomes,
        ReportState::Unavailable,
        reports,
    );
}

#[allow(clippy::too_many_arguments)]
fn seed_bench_run(
    world: &mut World,
    plans: &BTreeMap<EntityId, PlanTemplate>,
    seq: &mut u64,
    bench_id: &str,
    parameters: &str,
    started_at: DateTime<Local>,
    outcomes: &[(RunStatus, i64)],
    report: ReportState,
    reports: &ReportLibrary,
) {
    let bench_id = EntityId::new(bench_id);
    let Some(template) = plans.get(&bench_id) else {
        return;
    };

    let bench_run_id = run_id(*seq);
    *seq += 1;

    let mut steps = Vec::with_capacity(template.calls.len());
    for (index, call) in template.calls.iter().enumerate() {
        let (status, seconds) = outcomes
            .get(index)
            .copied()
            .unwrap_or((RunStatus::Succeeded, 60));

        let child_report = match status {
            RunStatus::Succeeded => reports.state(ReportKind::JobSuccess),
            RunStatus::Failed => reports.state(ReportKind::JobFailure),
            _ => ReportState::Unavailable,
        };

        let child_id = push_job_run(
            world,
            seq,
            call.job_id.as_str(),
            RunOrigin::BenchStep {
                bench_id: bench_id.clone(),
                bench_run_id: bench_run_id.clone(),
                step_index: index + 1,
            },
            started_at,
            Some(TimeDelta::seconds(seconds)),
            &derive_parameters(parameters, &call.parameter_suffix),
            status,
            child_report,
        );

        steps.push(BenchPlanStep {
            index: index + 1,
            job_id: call.job_id.clone(),
            parameters: derive_parameters(parameters, &call.parameter_suffix),
            run_id: child_id,
        });
    }

    let child_statuses: Vec<RunStatus> = outcomes.iter().map(|(status, _)| *status).collect();
    let status = aggregate_status(&child_statuses);

    let ended_at = if status.is_terminal() {
        steps
            .iter()
            .filter_map(|step| world.job_runs.get(&step.run_id))
            .filter_map(|run| run.ended_at)
            .max()
    } else {
        None
    };

    let bench_run = BenchRun {
        id: bench_run_id.clone(),
        bench_id: bench_id.clone(),
        started_at,
        ended_at,
        parameters: parameters.to_owned(),
        plan: BenchPlan { steps },
        status,
        query_health: QueryHealth::Healthy,
        last_successful_query: ended_at.unwrap_or(started_at),
        report,
        error: None,
    };

    world.bench_runs.insert(bench_run_id.clone(), bench_run);
    world.index_bench_run(bench_run_id);
}

/// How a Bench derives one call's parameters from its own input string.
pub fn derive_parameters(bench_parameters: &str, suffix: &str) -> String {
    match (bench_parameters.trim(), suffix.trim()) {
        ("", "") => String::new(),
        (bench, "") => bench.to_owned(),
        ("", suffix) => suffix.to_owned(),
        (bench, suffix) => format!("{bench} {suffix}"),
    }
}
