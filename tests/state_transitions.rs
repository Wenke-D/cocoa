//! Backend state-transition tests (specification §37.1).
//!
//! These lock in the corrected Bench model: a Bench fans out to existing Jobs,
//! its children are ordinary Job runs stored once, and a failing child never
//! stops its siblings.

use chrono::{DateTime, Local, TimeDelta, TimeZone};

use experiment_manager::backend::{BackendError, CancelTarget, ExperimentBackend, MockBackend};
use experiment_manager::model::{EntityId, ReportState, RunId, RunOrigin, RunStatus};

fn base_time() -> DateTime<Local> {
    Local.with_ymd_and_hms(2026, 8, 15, 10, 24, 0).unwrap()
}

fn backend() -> MockBackend {
    let mut backend = MockBackend::new(base_time());
    // Every test drives progression by hand so results are reproducible.
    backend.set_auto_progress(false);
    backend
}

fn job(id: &str) -> EntityId {
    EntityId::new(id)
}

fn status_of(backend: &MockBackend, run_id: &RunId) -> RunStatus {
    backend
        .snapshot()
        .job_run(run_id)
        .unwrap_or_else(|| panic!("missing job run {run_id}"))
        .status
}

fn bench_status(backend: &MockBackend, run_id: &RunId) -> RunStatus {
    backend
        .snapshot()
        .bench_run(run_id)
        .unwrap_or_else(|| panic!("missing bench run {run_id}"))
        .status
}

fn child_run_ids(backend: &MockBackend, bench_run_id: &RunId) -> Vec<RunId> {
    backend
        .snapshot()
        .bench_run(bench_run_id)
        .expect("bench run")
        .plan
        .run_ids()
        .cloned()
        .collect()
}

// ---------------------------------------------------------------- Job lifecycle

#[test]
fn starting_a_job_creates_a_starting_run() {
    let mut backend = backend();
    let run_id = backend
        .start(&job("solver-gpu"), "--mesh=256".to_owned())
        .expect("start should succeed");

    let snapshot = backend.snapshot();
    let run = snapshot.job_run(&run_id).expect("run exists");
    assert_eq!(run.status, RunStatus::Starting);
    assert_eq!(run.parameters, "--mesh=256");
    assert_eq!(run.origin, RunOrigin::Direct);
    assert!(run.ended_at.is_none());
}

#[test]
fn advancing_a_job_moves_it_from_starting_to_running() {
    let mut backend = backend();
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();

    assert_eq!(status_of(&backend, &run_id), RunStatus::Starting);
    backend.advance_run(&run_id);
    assert_eq!(status_of(&backend, &run_id), RunStatus::Running);
}

#[test]
fn cancelling_a_job_passes_through_cancelling() {
    let mut backend = backend();
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();
    backend.advance_run(&run_id);

    backend
        .cancel(CancelTarget::JobRun(run_id.clone()))
        .expect("cancel accepted");
    assert_eq!(
        status_of(&backend, &run_id),
        RunStatus::Cancelling,
        "a run must never jump straight to Cancelled"
    );

    backend.advance_run(&run_id);
    assert_eq!(status_of(&backend, &run_id), RunStatus::Cancelled);
}

#[test]
fn an_invalid_manifest_blocks_start() {
    let mut backend = backend();
    let error = backend
        .start(&job("invalid-job"), String::new())
        .expect_err("start must be refused");
    assert!(matches!(error, BackendError::ManifestUnusable { .. }));
}

#[test]
fn a_job_requiring_parameters_rejects_an_empty_string() {
    let mut backend = backend();
    let error = backend
        .start(&job("solver-cpu"), "   ".to_owned())
        .expect_err("start must be refused");
    assert_eq!(error, BackendError::ParametersRequired);
}

#[test]
fn runs_are_independent_so_start_always_succeeds() {
    let mut backend = backend();
    let first = backend
        .start(&job("solver-gpu"), "--mesh=64".to_owned())
        .unwrap();
    let second = backend
        .start(&job("solver-gpu"), "--mesh=128".to_owned())
        .expect("a second concurrent run is always allowed");

    assert_ne!(first, second);
    assert!(status_of(&backend, &first).is_active());
    assert!(status_of(&backend, &second).is_active());
}

// ------------------------------------------------------------- Bench fan-out

#[test]
fn starting_a_bench_dispatches_every_call_at_once() {
    let mut backend = backend();
    let bench_run_id = backend
        .start(&job("nightly-benchmark"), "--dataset=nightly".to_owned())
        .expect("bench start");

    let snapshot = backend.snapshot();
    let bench_run = snapshot.bench_run(&bench_run_id).expect("bench run");
    assert_eq!(bench_run.plan.len(), 6);

    for step in &bench_run.plan.steps {
        let child = snapshot.job_run(&step.run_id).expect("child dispatched");
        assert_eq!(
            child.status,
            RunStatus::Starting,
            "every call is dispatched immediately; none waits its turn"
        );
        assert_ne!(
            child.status,
            RunStatus::Pending,
            "a Bench run has no pending calls after a successful start"
        );
    }

    assert_eq!(bench_run.status, RunStatus::Starting);
}

#[test]
fn a_dispatched_run_belongs_to_the_referenced_job_and_is_stored_once() {
    let mut backend = backend();
    let bench_run_id = backend
        .start(&job("nightly-benchmark"), String::new())
        .unwrap();

    let snapshot = backend.snapshot();
    let step = snapshot
        .bench_run(&bench_run_id)
        .unwrap()
        .plan
        .steps
        .iter()
        .find(|step| step.job_id == job("solver-gpu"))
        .expect("the plan calls Solver GPU");

    let child = snapshot.job_run(&step.run_id).expect("child run");
    assert_eq!(child.job_id, job("solver-gpu"));
    assert_eq!(
        child.origin,
        RunOrigin::BenchStep {
            bench_id: job("nightly-benchmark"),
            bench_run_id: bench_run_id.clone(),
            step_index: step.index,
        }
    );

    // It is an ordinary row in that Job's own history, and appears exactly once.
    let occurrences = snapshot
        .job_history(&job("solver-gpu"))
        .filter(|run| run.id == step.run_id)
        .count();
    assert_eq!(occurrences, 1, "the run record must not be duplicated");
}

#[test]
fn a_plan_may_call_the_same_job_many_times_with_different_parameters() {
    let mut backend = backend();
    let bench_run_id = backend
        .start(&job("parameter-sweep"), "--gpu=0".to_owned())
        .unwrap();

    let snapshot = backend.snapshot();
    let plan = &snapshot.bench_run(&bench_run_id).unwrap().plan;
    assert_eq!(plan.len(), 5);

    assert!(
        plan.steps
            .iter()
            .all(|step| step.job_id == job("solver-gpu")),
        "the sweep calls one Job repeatedly"
    );

    let mut parameters: Vec<&str> = plan.steps.iter().map(|s| s.parameters.as_str()).collect();
    parameters.sort_unstable();
    parameters.dedup();
    assert_eq!(parameters.len(), 5, "each call gets its own parameters");

    let mut run_ids: Vec<&RunId> = plan.steps.iter().map(|s| &s.run_id).collect();
    run_ids.sort();
    run_ids.dedup();
    assert_eq!(run_ids.len(), 5, "each call gets its own run");

    // Derived parameters combine the Bench input with the call's own suffix.
    assert!(
        plan.steps
            .iter()
            .any(|s| s.parameters == "--gpu=0 --mesh=64")
    );
}

#[test]
fn an_invalid_plan_dispatches_nothing() {
    let mut backend = backend();
    let before = backend.snapshot();
    let job_runs_before = before.job_runs.len();
    let bench_runs_before = before.bench_runs.len();
    drop(before);

    let error = backend
        .start(&job("broken-plan"), String::new())
        .expect_err("plan validation must refuse the start");

    match error {
        BackendError::InvalidPlan { call_index, .. } => assert_eq!(call_index, 3),
        other => panic!("expected InvalidPlan, got {other:?}"),
    }

    let after = backend.snapshot();
    assert_eq!(
        after.job_runs.len(),
        job_runs_before,
        "validation is all-or-nothing: no partial dispatch"
    );
    assert_eq!(after.bench_runs.len(), bench_runs_before);
}

#[test]
fn a_failed_child_does_not_stop_its_siblings() {
    let mut backend = backend();
    let bench_run_id = backend
        .start(&job("nightly-benchmark"), String::new())
        .unwrap();
    let children = child_run_ids(&backend, &bench_run_id);

    for child in &children {
        backend.advance_run(child); // Starting -> Running
    }

    backend.finish_run(&children[4], RunStatus::Failed);

    assert_eq!(status_of(&backend, &children[4]), RunStatus::Failed);
    for (index, child) in children.iter().enumerate() {
        if index != 4 {
            assert_eq!(
                status_of(&backend, child),
                RunStatus::Running,
                "sibling {index} must keep running"
            );
        }
    }
    assert_eq!(
        bench_status(&backend, &bench_run_id),
        RunStatus::Running,
        "the aggregate stays active while any child is active"
    );

    for (index, child) in children.iter().enumerate() {
        if index != 4 {
            backend.finish_run(child, RunStatus::Succeeded);
        }
    }

    assert_eq!(
        bench_status(&backend, &bench_run_id),
        RunStatus::Failed,
        "the aggregate resolves only once every child is terminal"
    );
}

#[test]
fn cancelling_a_bench_touches_only_its_own_active_children() {
    let mut backend = backend();

    // A run of the same Job that the Bench did not dispatch.
    let unrelated = backend
        .start(&job("solver-gpu"), "--mesh=8".to_owned())
        .unwrap();
    backend.advance_run(&unrelated);

    let bench_run_id = backend
        .start(&job("parameter-sweep"), "--gpu=0".to_owned())
        .unwrap();
    let children = child_run_ids(&backend, &bench_run_id);
    for child in &children {
        backend.advance_run(child);
    }

    // One child finishes before the cancellation.
    backend.finish_run(&children[0], RunStatus::Succeeded);

    backend
        .cancel(CancelTarget::BenchRun(bench_run_id.clone()))
        .expect("cancel accepted");

    assert_eq!(
        status_of(&backend, &children[0]),
        RunStatus::Succeeded,
        "a child that already finished keeps its result"
    );
    for child in &children[1..] {
        assert_eq!(status_of(&backend, child), RunStatus::Cancelling);
    }
    assert_eq!(
        status_of(&backend, &unrelated),
        RunStatus::Running,
        "a run the Bench did not dispatch is untouched"
    );

    for child in &children[1..] {
        backend.advance_run(child);
    }
    assert_eq!(bench_status(&backend, &bench_run_id), RunStatus::Cancelled);
}

#[test]
fn cancelling_one_child_leaves_the_bench_and_its_siblings_alone() {
    let mut backend = backend();
    let bench_run_id = backend
        .start(&job("parameter-sweep"), String::new())
        .unwrap();
    let children = child_run_ids(&backend, &bench_run_id);
    for child in &children {
        backend.advance_run(child);
    }

    backend
        .cancel(CancelTarget::JobRun(children[2].clone()))
        .expect("cancel accepted");

    assert_eq!(status_of(&backend, &children[2]), RunStatus::Cancelling);
    for (index, child) in children.iter().enumerate() {
        if index != 2 {
            assert_eq!(status_of(&backend, child), RunStatus::Running);
        }
    }
    assert_eq!(
        bench_status(&backend, &bench_run_id),
        RunStatus::Cancelling,
        "the Bench reflects its children but was not itself cancelled"
    );

    backend.advance_run(&children[2]);
    assert_eq!(
        bench_status(&backend, &bench_run_id),
        RunStatus::Running,
        "with the cancelled child terminal, the rest keep the Bench running"
    );
}

#[test]
fn cancelling_a_finished_bench_run_is_refused() {
    let mut backend = backend();
    let bench_run_id = backend.start(&job("smoke-test"), String::new()).unwrap();
    for child in child_run_ids(&backend, &bench_run_id) {
        backend.finish_run(&child, RunStatus::Succeeded);
    }

    let error = backend
        .cancel(CancelTarget::BenchRun(bench_run_id))
        .expect_err("nothing left to cancel");
    assert!(matches!(error, BackendError::NotCancellable { .. }));
}

#[test]
fn a_failed_cancellation_restores_nothing() {
    let mut backend = backend();
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();
    backend.advance_run(&run_id);
    backend.set_simulate_cancel_failure(true);

    let error = backend
        .cancel(CancelTarget::JobRun(run_id.clone()))
        .expect_err("cancellation fails");
    assert!(matches!(error, BackendError::Simulated(_)));
    assert_eq!(
        status_of(&backend, &run_id),
        RunStatus::Running,
        "a failed cancellation must leave the previous status in place"
    );
}

// --------------------------------------------------------------- Query health

#[test]
fn query_failure_does_not_overwrite_the_last_known_status() {
    let mut backend = backend();
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();
    backend.advance_run(&run_id);
    assert_eq!(status_of(&backend, &run_id), RunStatus::Running);

    backend.toggle_query_unavailable(&run_id);

    let snapshot = backend.snapshot();
    let run = snapshot.job_run(&run_id).unwrap();
    assert_eq!(
        run.status,
        RunStatus::Running,
        "execution status must survive a query outage"
    );
    assert!(!run.query_health.is_available());
    assert_eq!(run.display_status().label(), "Unknown");
    assert_ne!(run.status, RunStatus::Failed);
}

#[test]
fn an_unqueryable_run_does_not_visibly_progress() {
    let mut backend = MockBackend::new(base_time());
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();
    backend.advance_run(&run_id);
    backend.toggle_query_unavailable(&run_id);

    let frozen_at = backend
        .snapshot()
        .job_run(&run_id)
        .unwrap()
        .last_successful_query;

    backend.tick(base_time() + TimeDelta::minutes(10));

    let snapshot = backend.snapshot();
    let run = snapshot.job_run(&run_id).unwrap();
    assert_eq!(run.status, RunStatus::Running);
    assert_eq!(
        run.last_successful_query, frozen_at,
        "the last successful query time must not advance while contact is lost"
    );

    backend.toggle_query_unavailable(&run_id);
    backend.tick(base_time() + TimeDelta::minutes(11));
    assert!(
        backend
            .snapshot()
            .job_run(&run_id)
            .unwrap()
            .status
            .is_terminal(),
        "progression resumes once query health is restored"
    );
}

// ------------------------------------------------------------------- Reports

#[test]
fn report_generation_reaches_available() {
    let mut backend = backend();
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();

    backend.advance_run(&run_id); // Starting -> Running
    backend.advance_run(&run_id); // Running  -> Succeeded, report generating

    let snapshot = backend.snapshot();
    let run = snapshot.job_run(&run_id).unwrap();
    assert_eq!(run.status, RunStatus::Succeeded);
    assert_eq!(
        run.report,
        ReportState::Generating,
        "a succeeded run may temporarily have no report"
    );
    drop(snapshot);

    backend.advance_run(&run_id); // report becomes available
    assert!(
        backend
            .snapshot()
            .job_run(&run_id)
            .unwrap()
            .report
            .is_available()
    );
    assert!(backend.report(&run_id).unwrap().is_available());
}

#[test]
fn a_report_read_error_is_a_state_not_a_failure() {
    let mut backend = backend();
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();
    backend.set_report(
        &run_id,
        ReportState::ReadError {
            message: "permission denied".to_owned(),
        },
    );

    // The unreadable report is reported as a state the UI renders, not as an
    // operation failure. Only an unknown run is an error.
    assert!(matches!(
        backend.report(&run_id).unwrap(),
        ReportState::ReadError { .. }
    ));
    assert!(matches!(
        backend.report(&RunId::new("run-999999")),
        Err(BackendError::UnknownRun(_))
    ));
}

#[test]
fn a_bench_run_gets_its_own_report_once_every_child_is_terminal() {
    let mut backend = backend();
    let bench_run_id = backend.start(&job("smoke-test"), String::new()).unwrap();

    for child in child_run_ids(&backend, &bench_run_id) {
        backend.finish_run(&child, RunStatus::Succeeded);
    }
    assert_eq!(bench_status(&backend, &bench_run_id), RunStatus::Succeeded);

    backend.advance_run(&bench_run_id);
    assert!(
        backend
            .snapshot()
            .bench_run(&bench_run_id)
            .unwrap()
            .report
            .is_available()
    );
}

#[test]
fn both_report_formats_are_present_in_the_fixtures() {
    use experiment_manager::model::ReportFormat;

    let backend = backend();
    let snapshot = backend.snapshot();

    let formats: Vec<ReportFormat> = snapshot
        .job_runs
        .values()
        .filter_map(|run| run.report.format())
        .chain(
            snapshot
                .bench_runs
                .values()
                .filter_map(|run| run.report.format()),
        )
        .collect();

    assert!(formats.contains(&ReportFormat::PlainText));
    assert!(
        formats.contains(&ReportFormat::Html),
        "HTML reports must be exercised too"
    );
}

// -------------------------------------------------------------- Housekeeping

#[test]
fn automatic_progression_advances_active_runs() {
    let mut backend = MockBackend::new(base_time());
    let run_id = backend.start(&job("solver-gpu"), String::new()).unwrap();

    backend.tick(base_time() + TimeDelta::seconds(3));
    assert_eq!(status_of(&backend, &run_id), RunStatus::Running);

    backend.tick(base_time() + TimeDelta::minutes(5));
    assert!(status_of(&backend, &run_id).is_terminal());
}

#[test]
fn the_active_run_count_treats_a_bench_as_one_thing() {
    let mut backend = backend();
    let before = backend.snapshot().active_run_count();

    backend
        .start(&job("parameter-sweep"), String::new())
        .unwrap();

    assert_eq!(
        backend.snapshot().active_run_count(),
        before + 1,
        "a 5-call sweep is one active run to the user, not five"
    );
}

#[test]
fn bulk_history_stays_addressable() {
    let mut backend = backend();
    let before = backend.snapshot().job_history(&job("solver-gpu")).count();

    backend.generate_history(&job("solver-gpu"), 500);

    let snapshot = backend.snapshot();
    assert_eq!(
        snapshot.job_history(&job("solver-gpu")).count(),
        before + 500
    );

    // History is newest first.
    let history: Vec<_> = snapshot.job_history(&job("solver-gpu")).collect();
    for pair in history.windows(2) {
        assert!(pair[0].started_at >= pair[1].started_at);
    }
}

#[test]
fn resetting_rebuilds_the_demo_library() {
    let mut backend = backend();
    backend.start(&job("solver-gpu"), String::new()).unwrap();
    let grown = backend.snapshot().job_runs.len();

    backend.reset(base_time());
    assert!(backend.snapshot().job_runs.len() < grown);
    assert!(!backend.snapshot().entities.is_empty());
}

#[test]
fn fixtures_cover_the_required_historical_states() {
    let backend = backend();
    let snapshot = backend.snapshot();

    let has = |status: RunStatus| snapshot.job_runs.values().any(|run| run.status == status);
    for status in [
        RunStatus::Starting,
        RunStatus::Running,
        RunStatus::Succeeded,
        RunStatus::Failed,
        RunStatus::Cancelling,
        RunStatus::Cancelled,
    ] {
        assert!(
            has(status),
            "fixtures must include a {} run",
            status.label()
        );
    }

    assert!(
        snapshot
            .job_runs
            .values()
            .any(|run| !run.query_health.is_available()),
        "fixtures must include a query-unavailable run"
    );

    let reports = |matches: fn(&ReportState) -> bool| {
        snapshot.job_runs.values().any(|run| matches(&run.report))
    };
    assert!(reports(|r| matches!(r, ReportState::Available { .. })));
    assert!(reports(|r| matches!(r, ReportState::Generating)));
    assert!(reports(|r| matches!(r, ReportState::Missing)));
    assert!(reports(|r| matches!(r, ReportState::ReadError { .. })));
}

#[test]
fn fixture_bench_children_appear_in_their_jobs_histories() {
    let backend = backend();
    let snapshot = backend.snapshot();

    let bench_run = snapshot
        .bench_history(&job("nightly-benchmark"))
        .next()
        .expect("a historical Bench run");

    for step in &bench_run.plan.steps {
        let child = snapshot.job_run(&step.run_id).expect("child run stored");
        assert_eq!(child.job_id, step.job_id);
        assert!(
            snapshot
                .job_history(&step.job_id)
                .any(|run| run.id == step.run_id),
            "call {} must appear in {}'s own history",
            step.index,
            snapshot.entity_name(&step.job_id)
        );
    }
}
