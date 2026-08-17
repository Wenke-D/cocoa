//! Route tests (specification §37.2).
//!
//! The load-bearing case is dual-route run identity: one run record, two
//! addresses, different Library selection and breadcrumbs in each.

use chrono::{DateTime, Local, TimeZone};

use experiment_manager::app::{AppCommand, ExperimentApp};
use experiment_manager::backend::MockBackend;
use experiment_manager::model::{EntityId, RunId};
use experiment_manager::navigation::{ReportContext, Route};

fn base_time() -> DateTime<Local> {
    Local.with_ymd_and_hms(2026, 8, 15, 10, 24, 0).unwrap()
}

fn app() -> ExperimentApp {
    let mut backend = MockBackend::new(base_time());
    backend.set_auto_progress(false);
    ExperimentApp::with_backend(Box::new(backend))
}

fn id(value: &str) -> EntityId {
    EntityId::new(value)
}

/// Start a Bench and return `(bench run id, one child run id, that child's Job)`.
fn dispatched(app: &mut ExperimentApp) -> (RunId, RunId, EntityId) {
    app.execute(AppCommand::SubmitStart {
        entity_id: id("nightly-benchmark"),
        parameters: "--dataset=nightly".to_owned(),
    });
    app.poll();

    let Route::BenchRunDetail { run_id, .. } = app.route().clone() else {
        panic!("starting a Bench must open its run detail");
    };

    let snapshot = app.snapshot();
    let step = snapshot
        .bench_run(&run_id)
        .expect("bench run")
        .plan
        .steps
        .iter()
        .find(|step| step.job_id == id("solver-gpu"))
        .expect("the plan calls Solver GPU")
        .clone();

    (run_id, step.run_id, step.job_id)
}

#[test]
fn selecting_an_entity_opens_its_overview() {
    let mut app = app();
    app.execute(AppCommand::SelectEntity(id("solver-gpu")));

    assert_eq!(
        app.route(),
        &Route::EntityOverview {
            entity_id: id("solver-gpu")
        }
    );
}

#[test]
fn starting_a_job_opens_its_run_detail() {
    let mut app = app();
    app.execute(AppCommand::SubmitStart {
        entity_id: id("solver-gpu"),
        parameters: "--mesh=256".to_owned(),
    });
    app.poll();

    assert!(
        matches!(app.route(), Route::JobRunDetail { job_id, .. } if job_id == &id("solver-gpu"))
    );
}

#[test]
fn a_dispatched_run_has_two_routes_with_different_context() {
    let mut app = app();
    let (bench_run_id, child_run_id, job_id) = dispatched(&mut app);

    // Through the Bench: the Bench stays selected.
    let via_bench = Route::BenchChildRunDetail {
        bench_id: id("nightly-benchmark"),
        bench_run_id: bench_run_id.clone(),
        child_run_id: child_run_id.clone(),
    };
    assert_eq!(via_bench.selected_entity(), Some(&id("nightly-benchmark")));

    // Through the Job's own history: the Job is selected.
    let via_job = Route::JobRunDetail {
        job_id: job_id.clone(),
        run_id: child_run_id.clone(),
    };
    assert_eq!(via_job.selected_entity(), Some(&job_id));

    // Same underlying run record either way.
    let snapshot = app.snapshot();
    assert!(snapshot.job_run(&child_run_id).is_some());
    assert_eq!(
        snapshot
            .job_history(&job_id)
            .filter(|r| r.id == child_run_id)
            .count(),
        1
    );
}

#[test]
fn a_child_run_breadcrumb_disambiguates_repeated_calls() {
    let mut app = app();
    app.execute(AppCommand::SubmitStart {
        entity_id: id("parameter-sweep"),
        parameters: "--gpu=0".to_owned(),
    });
    app.poll();

    let Route::BenchRunDetail { run_id, .. } = app.route().clone() else {
        panic!("expected a Bench run route");
    };

    let snapshot = app.snapshot();
    let steps = snapshot.bench_run(&run_id).unwrap().plan.steps.clone();

    // Every call targets the same Job, so leaf labels must still differ.
    let leaves: Vec<String> = steps
        .iter()
        .map(|step| {
            Route::BenchChildRunDetail {
                bench_id: id("parameter-sweep"),
                bench_run_id: run_id.clone(),
                child_run_id: step.run_id.clone(),
            }
            .breadcrumbs(&snapshot)
            .last()
            .unwrap()
            .label
            .clone()
        })
        .collect();

    let mut unique = leaves.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(
        unique.len(),
        leaves.len(),
        "ambiguous breadcrumb leaves: {leaves:?}"
    );
}

#[test]
fn breadcrumb_ancestors_are_clickable_and_the_leaf_is_not() {
    let mut app = app();
    let (bench_run_id, child_run_id, _) = dispatched(&mut app);
    let snapshot = app.snapshot();

    let crumbs = Route::BenchChildRunDetail {
        bench_id: id("nightly-benchmark"),
        bench_run_id: bench_run_id.clone(),
        child_run_id,
    }
    .breadcrumbs(&snapshot);

    assert_eq!(crumbs.len(), 3);
    assert!(crumbs[0].route.is_some());
    assert!(crumbs[1].route.is_some());
    assert!(crumbs[2].route.is_none(), "the current page is not a link");
}

#[test]
fn opening_and_closing_a_report_returns_to_the_correct_parent() {
    let mut app = app();
    let (bench_run_id, child_run_id, _) = dispatched(&mut app);

    let report = Route::ReportViewer {
        context: ReportContext::BenchChildRun {
            bench_id: id("nightly-benchmark"),
            bench_run_id: bench_run_id.clone(),
        },
        run_id: child_run_id.clone(),
    };
    app.execute(AppCommand::Navigate(report));

    // A report keeps the Bench selected, not the Job it happens to belong to.
    assert_eq!(
        app.route().selected_entity(),
        Some(&id("nightly-benchmark"))
    );

    app.execute(AppCommand::NavigateBack);
    assert_eq!(
        app.route(),
        &Route::BenchChildRunDetail {
            bench_id: id("nightly-benchmark"),
            bench_run_id,
            child_run_id,
        }
    );
}

#[test]
fn a_missing_entity_recovers_without_panic() {
    let mut app = app();
    app.execute(AppCommand::Navigate(Route::EntityOverview {
        entity_id: id("does-not-exist"),
    }));

    app.recover_route();

    assert!(
        matches!(app.route(), Route::EntityOverview { entity_id } if entity_id != &id("does-not-exist"))
    );
}

#[test]
fn a_missing_run_returns_to_the_owning_entity() {
    let mut app = app();
    app.execute(AppCommand::Navigate(Route::JobRunDetail {
        job_id: id("solver-gpu"),
        run_id: RunId::new("run-999999"),
    }));

    app.recover_route();

    assert_eq!(
        app.route(),
        &Route::EntityOverview {
            entity_id: id("solver-gpu")
        }
    );
}

#[test]
fn a_missing_child_run_returns_to_the_bench_run() {
    let mut app = app();
    let (bench_run_id, _, _) = dispatched(&mut app);

    app.execute(AppCommand::Navigate(Route::BenchChildRunDetail {
        bench_id: id("nightly-benchmark"),
        bench_run_id: bench_run_id.clone(),
        child_run_id: RunId::new("run-999999"),
    }));
    app.recover_route();

    assert_eq!(
        app.route(),
        &Route::BenchRunDetail {
            bench_id: id("nightly-benchmark"),
            run_id: bench_run_id,
        }
    );
}

#[test]
fn an_empty_library_route_moves_to_the_first_entity_when_one_exists() {
    let mut app = app();
    app.execute(AppCommand::Navigate(Route::EmptyLibrary));
    app.recover_route();

    assert!(matches!(app.route(), Route::EntityOverview { .. }));
}

#[test]
fn a_failed_start_keeps_the_user_where_they_were() {
    let mut app = app();
    app.execute(AppCommand::SelectEntity(id("broken-plan")));
    let before = app.route().clone();

    app.execute(AppCommand::OpenStartModal(id("broken-plan")));
    app.execute(AppCommand::SubmitStart {
        entity_id: id("broken-plan"),
        parameters: String::new(),
    });
    app.poll();

    assert_eq!(app.route(), &before, "a refused start must not navigate");
    assert_eq!(
        app.snapshot().bench_history(&id("broken-plan")).count(),
        0,
        "nothing was dispatched"
    );
}
