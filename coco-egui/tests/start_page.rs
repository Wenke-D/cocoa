//! The Start page as a place (specification §15).
//!
//! Starting used to happen in a modal. The behaviour worth pinning down after
//! the move is the part a modal got for free: what the route says, what the
//! draft outlives, and what a relaunch restores.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use coco::adapter::EngineAdapter;
use coco::app::{AppCommand, ExperimentApp};
use coco::engine::Coco;
use coco::navigation::Route;
use tempfile::TempDir;

fn write_experiment(folder: &Path, name: &str) {
    fs::create_dir_all(folder).unwrap();
    fs::write(folder.join("job.tmpl"), "#!/bin/sh\necho {{ size }}\n").unwrap();
    // `launch` has to print the handle coco will track (convention §6).
    let bodies = [
        ("launch.sh", "#!/bin/sh\necho 'COCO_RETURN: handle-1'\n"),
        ("poll.sh", "#!/bin/sh\necho 'COCO_RETURN: RUNNING'\n"),
        ("report.sh", "#!/bin/sh\necho ok\n"),
        ("cancel.sh", "#!/bin/sh\necho ok\n"),
    ];
    for (script, body) in bodies {
        let path = folder.join(script);
        fs::write(&path, body).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&path, permissions).unwrap();
    }
    fs::write(
        folder.join("coco.toml"),
        format!(
            r#"
kind     = "job"
name     = "{name}"

[render]
template = "job.tmpl"
params   = ["size"]

[launch]
command  = "./launch.sh"
params   = []

[poll]
command  = "./poll.sh"

[report]
command  = "./report.sh"

[cancel]
command  = "./cancel.sh"
"#
        ),
    )
    .unwrap();
}

fn app_with_one_job(dir: &TempDir) -> ExperimentApp {
    let folder = dir.path().join("solver");
    write_experiment(&folder, "solver");
    let mut app = ExperimentApp::with_experiments(Box::new(EngineAdapter::new(
        Coco::new(dir.path().join("store.json")).unwrap(),
    )));
    app.add_folder(&folder);
    app
}

/// Start is a route now, so the trail can name it and Back knows where it goes.
#[test]
fn starting_navigates_to_a_page_under_the_experiment() {
    let dir = TempDir::new().unwrap();
    let mut app = app_with_one_job(&dir);
    let entity_id = app.snapshot().entities[0].id.clone();

    app.execute(AppCommand::OpenStartPage(entity_id.clone()));

    assert_eq!(
        app.ui.route,
        Route::StartRun {
            entity_id: entity_id.clone()
        }
    );
    // The Explorer keeps the experiment selected, and the trail leads back to it.
    assert_eq!(app.ui.route.selected_entity(), Some(&entity_id));
    assert_eq!(
        app.ui.route.parent(),
        Some(Route::EntityOverview {
            entity_id: entity_id.clone()
        })
    );

    let crumbs = app.ui.route.breadcrumbs(&app.snapshot());
    assert_eq!(crumbs.len(), 2, "{crumbs:?}");
    assert_eq!(crumbs[0].label, "solver");
    assert_eq!(crumbs[1].label, "Start");
    assert!(crumbs[1].route.is_none(), "the last crumb is where we are");

    // The draft is open and empty: every declared parameter, no prefill (§15.3).
    assert_eq!(app.ui.start_draft.entity_id.as_ref(), Some(&entity_id));
    assert_eq!(app.ui.start_draft.fields.len(), 1);
    assert!(app.ui.start_draft.fields.values().all(String::is_empty));
}

/// The run page is reached from the overview, never from the form — so Back out
/// of a run never lands on the form that started it.
#[test]
fn a_started_run_leads_back_past_the_form() {
    let dir = TempDir::new().unwrap();
    let mut app = app_with_one_job(&dir);
    let entity_id = app.snapshot().entities[0].id.clone();

    app.execute(AppCommand::OpenStartPage(entity_id.clone()));
    app.execute(AppCommand::SubmitStart {
        entity_id: entity_id.clone(),
        parameters: [("size".to_owned(), "1".to_owned())].into_iter().collect(),
    });
    app.apply_pending();

    assert!(
        matches!(app.ui.route, Route::JobRunDetail { .. }),
        "{:?}",
        app.ui.route
    );
    assert_eq!(
        app.ui.route.parent(),
        Some(Route::EntityOverview { entity_id }),
        "back out of a run must reach the overview, not the form"
    );
    // A start that worked leaves no draft behind (§15.3).
    assert_eq!(app.ui.start_draft, coco::app::StartDraft::default());
}

/// A route is restored on relaunch and a draft is not, so a persisted Start
/// page would open an empty form nobody asked for (§15).
#[test]
fn a_persisted_start_page_lands_on_the_experiment() {
    let dir = TempDir::new().unwrap();
    let mut app = app_with_one_job(&dir);
    let entity_id = app.snapshot().entities[0].id.clone();

    app.execute(AppCommand::OpenStartPage(entity_id.clone()));

    let mut restored: coco::app::UiState =
        serde_json::from_str(&serde_json::to_string(&app.ui).unwrap()).unwrap();
    restored.sanitize();

    assert_eq!(restored.route, Route::EntityOverview { entity_id });
    assert_eq!(
        restored.start_draft,
        coco::app::StartDraft::default(),
        "the draft is not persisted"
    );
}
