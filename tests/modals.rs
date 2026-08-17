//! Modal and detail-page behaviour (specification §11.5, §15, §16, §31).

use chrono::{DateTime, Local, TimeZone};

use experiment_manager::app::{AppCommand, ExperimentApp};
use experiment_manager::backend::{CancelTarget, DemoEntityKind, MockBackend};
use experiment_manager::model::{EntityId, EntityKind, RunStatus};
use experiment_manager::navigation::{Overlay, Route, SubmitState};

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

// ------------------------------------------------------------- Start modal

#[test]
fn opening_the_start_modal_prefills_and_asks_for_focus() {
    let mut app = app();
    app.execute(AppCommand::OpenStartModal(id("solver-gpu")));

    match &app.ui.overlay {
        Overlay::StartRun {
            parameter_draft,
            submit_state,
            ..
        } => {
            assert_eq!(parameter_draft, "--mesh=256 --gpu=0", "manifest default");
            assert_eq!(submit_state, &SubmitState::Idle);
        }
        other => panic!("expected a Start modal, got {other:?}"),
    }

    assert!(
        app.ui.focus_parameter_field,
        "the parameter field must be focused on open"
    );
}

#[test]
fn the_draft_prefers_the_last_used_parameters() {
    let mut app = app();
    app.execute(AppCommand::SubmitStart {
        entity_id: id("solver-gpu"),
        parameters: "--mesh=999".to_owned(),
    });
    app.poll();

    app.execute(AppCommand::OpenStartModal(id("solver-gpu")));
    match &app.ui.overlay {
        Overlay::StartRun {
            parameter_draft, ..
        } => assert_eq!(parameter_draft, "--mesh=999"),
        other => panic!("expected a Start modal, got {other:?}"),
    }
}

#[test]
fn submission_is_visible_before_it_completes() {
    let mut app = app();
    app.execute(AppCommand::OpenStartModal(id("solver-gpu")));
    app.execute(AppCommand::SubmitStart {
        entity_id: id("solver-gpu"),
        parameters: "--mesh=256".to_owned(),
    });

    // One frame of `Starting…` before the backend is asked.
    match &app.ui.overlay {
        Overlay::StartRun { submit_state, .. } => {
            assert_eq!(submit_state, &SubmitState::Submitting)
        }
        other => panic!("expected a submitting Start modal, got {other:?}"),
    }
    assert!(
        !app.ui.overlay.is_dismissible(),
        "Escape must not interrupt an in-flight submission"
    );

    app.poll();
    assert!(matches!(app.ui.overlay, Overlay::None));
}

#[test]
fn a_failed_start_keeps_the_modal_open_with_the_draft_intact() {
    let mut app = app();
    app.execute(AppCommand::OpenStartModal(id("broken-plan")));
    app.execute(AppCommand::UpdateParameterDraft("--keep-me".to_owned()));
    app.execute(AppCommand::SubmitStart {
        entity_id: id("broken-plan"),
        parameters: "--keep-me".to_owned(),
    });
    app.poll();

    match &app.ui.overlay {
        Overlay::StartRun {
            parameter_draft,
            submit_state,
            ..
        } => {
            assert_eq!(parameter_draft, "--keep-me", "the draft must survive");
            match submit_state {
                SubmitState::Failed(message) => {
                    assert!(message.contains("Call 3"), "names the offending call");
                    assert!(message.contains("No runs were dispatched"));
                }
                other => panic!("expected a failure state, got {other:?}"),
            }
        }
        other => panic!("expected the modal to stay open, got {other:?}"),
    }
}

// ------------------------------------------------------------ Cancel modal

#[test]
fn cancelling_keeps_the_user_on_the_current_page() {
    let mut app = app();
    app.execute(AppCommand::SubmitStart {
        entity_id: id("solver-gpu"),
        parameters: String::new(),
    });
    app.poll();
    let route_before = app.route().clone();

    let Route::JobRunDetail { run_id, .. } = route_before.clone() else {
        panic!("expected a run detail route");
    };

    app.execute(AppCommand::RequestCancel(CancelTarget::JobRun(
        run_id.clone(),
    )));
    assert!(matches!(app.ui.overlay, Overlay::ConfirmCancel { .. }));

    app.execute(AppCommand::ConfirmCancel(CancelTarget::JobRun(
        run_id.clone(),
    )));

    assert!(matches!(app.ui.overlay, Overlay::None));
    assert_eq!(app.route(), &route_before, "cancelling must not navigate");
    assert_eq!(
        app.snapshot().job_run(&run_id).unwrap().status,
        RunStatus::Cancelling,
        "never label a run Cancelled before the transition completes"
    );
}

#[test]
fn a_failed_cancellation_reports_inline_and_keeps_the_modal() {
    let mut backend = MockBackend::new(base_time());
    backend.set_auto_progress(false);
    backend.set_simulate_cancel_failure(true);
    let mut app = ExperimentApp::with_backend(Box::new(backend));

    app.execute(AppCommand::SubmitStart {
        entity_id: id("solver-gpu"),
        parameters: String::new(),
    });
    app.poll();
    let Route::JobRunDetail { run_id, .. } = app.route().clone() else {
        panic!("expected a run detail route");
    };

    app.execute(AppCommand::RequestCancel(CancelTarget::JobRun(
        run_id.clone(),
    )));
    app.execute(AppCommand::ConfirmCancel(CancelTarget::JobRun(
        run_id.clone(),
    )));

    match &app.ui.overlay {
        Overlay::ConfirmCancel { error, .. } => {
            assert!(error.is_some(), "the failure is shown inline")
        }
        other => panic!("the modal must stay open, got {other:?}"),
    }
    assert_eq!(
        app.snapshot().job_run(&run_id).unwrap().status,
        RunStatus::Starting,
        "a failed cancellation restores the previous status"
    );
}

// -------------------------------------------------------- Add Demo Folder

#[test]
fn adding_a_demo_job_updates_the_library_immediately() {
    let mut app = app();
    let before = app.snapshot().entities.len();

    app.execute(AppCommand::OpenAddDemoFolder);
    app.execute(AppCommand::AddDemoEntity(DemoEntityKind::Job));

    let snapshot = app.snapshot();
    assert_eq!(snapshot.entities.len(), before + 1);
    assert!(matches!(app.ui.overlay, Overlay::None));
    assert!(
        matches!(app.route(), Route::EntityOverview { .. }),
        "the new entity is selected"
    );
}

#[test]
fn a_demo_bench_references_existing_library_jobs() {
    let mut app = app();
    app.execute(AppCommand::AddDemoEntity(DemoEntityKind::Bench));

    let Route::EntityOverview { entity_id } = app.route().clone() else {
        panic!("expected the new Bench to be selected");
    };
    assert_eq!(
        app.snapshot().entity(&entity_id).unwrap().kind,
        EntityKind::Bench
    );

    app.execute(AppCommand::SubmitStart {
        entity_id: entity_id.clone(),
        parameters: String::new(),
    });
    app.poll();

    let Route::BenchRunDetail { run_id, .. } = app.route().clone() else {
        panic!("the demo Bench must be startable");
    };

    let snapshot = app.snapshot();
    let plan = &snapshot.bench_run(&run_id).unwrap().plan;
    assert!(!plan.is_empty());
    for step in &plan.steps {
        let target = snapshot
            .entity(&step.job_id)
            .expect("every call references a Library entity");
        assert_eq!(target.kind, EntityKind::Job);
    }
}

#[test]
fn an_invalid_demo_entity_stays_visible_but_cannot_start() {
    let mut app = app();
    app.execute(AppCommand::AddDemoEntity(DemoEntityKind::InvalidManifest));

    let Route::EntityOverview { entity_id } = app.route().clone() else {
        panic!("expected the new entity to be selected");
    };

    let snapshot = app.snapshot();
    let entity = snapshot.entity(&entity_id).expect("kept in the Library");
    assert!(entity.manifest.blocking_reason().is_some());
    drop(snapshot);

    app.execute(AppCommand::SubmitStart {
        entity_id: entity_id.clone(),
        parameters: String::new(),
    });
    app.poll();

    assert_eq!(
        app.snapshot().job_history(&entity_id).count(),
        0,
        "an unusable manifest must not produce a run"
    );
}

// ------------------------------------------------------------ Query retry

#[test]
fn retrying_an_unavailable_query_reports_that_it_is_still_unavailable() {
    let mut backend = MockBackend::new(base_time());
    backend.set_auto_progress(false);
    let mut app = ExperimentApp::with_backend(Box::new(backend));

    app.execute(AppCommand::SubmitStart {
        entity_id: id("solver-gpu"),
        parameters: String::new(),
    });
    app.poll();
    let Route::JobRunDetail { run_id, .. } = app.route().clone() else {
        panic!("expected a run detail route");
    };

    app.backend_mut().toggle_query_unavailable(&run_id);
    app.execute(AppCommand::RetryQuery(run_id.clone()));

    let message = app.ui.transient_message.as_ref().expect("a message");
    assert!(message.is_error);

    // The execution status is untouched by any of this.
    assert_eq!(
        app.snapshot().job_run(&run_id).unwrap().status,
        RunStatus::Starting
    );
}

// ------------------------------------------------------------ Report viewer

#[test]
fn an_html_report_is_written_out_and_queued_for_the_browser() {
    use experiment_manager::model::ReportFormat;

    let app_backend = MockBackend::new(base_time());
    let mut app = ExperimentApp::with_backend(Box::new(app_backend));

    // A fixture run of Solver GPU carries an HTML report.
    let snapshot = app.snapshot();
    let run = snapshot
        .job_history(&id("solver-gpu"))
        .find(|run| run.report.format() == Some(ReportFormat::Html))
        .expect("a fixture HTML report");
    let run_id = run.id.clone();
    drop(snapshot);

    app.execute(AppCommand::OpenReportExternally(run_id.clone()));

    let url = app.pending_url().expect("a browser URL is queued");
    assert!(url.starts_with("file://"), "got {url}");
    assert!(url.ends_with(".html"), "HTML keeps its extension: {url}");

    let path = std::env::temp_dir().join(format!("experiment-report-{run_id}.html"));
    let written = std::fs::read_to_string(&path).expect("the report was written out");
    assert!(written.contains("<!doctype html>"));
    let _ = std::fs::remove_file(&path);
}

#[test]
fn opening_a_report_that_is_not_available_reports_an_error() {
    let mut app = app();

    // A cancelled fixture run has no report.
    let snapshot = app.snapshot();
    let run_id = snapshot
        .job_history(&id("solver-gpu"))
        .find(|run| !run.report.is_available())
        .expect("a run without a report")
        .id
        .clone();
    drop(snapshot);

    app.execute(AppCommand::OpenReportExternally(run_id));

    assert!(app.pending_url().is_none(), "nothing is opened");
    assert!(app.ui.transient_message.as_ref().unwrap().is_error);
}
