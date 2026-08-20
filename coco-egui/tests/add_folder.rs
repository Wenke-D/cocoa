//! Where an Add Folder pick reports what it did (specification §11.5).
//!
//! The split under test is not cosmetic: a pick can name a directory holding a
//! dozen experiments, and every folder it turns down has its own reason. The
//! status bar is one line, so it carries what was registered and the modal
//! carries the refusals.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use coco::adapter::EngineAdapter;
use coco::app::ExperimentApp;
use coco::engine::Coco;
use coco::navigation::Overlay;
use tempfile::TempDir;

/// A manifest complete enough to be valid, whose only interesting property is
/// the name it claims. An incomplete one would register as invalid and keep its
/// name out of the engine's hands, which is a different case entirely.
fn write_experiment(folder: &Path, name: &str) {
    fs::create_dir_all(folder).unwrap();
    fs::write(folder.join("job.tmpl"), "#!/bin/sh\n").unwrap();
    for script in ["launch.sh", "poll.sh", "report.sh", "cancel.sh"] {
        let path = folder.join(script);
        fs::write(&path, "#!/bin/sh\necho ok\n").unwrap();
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
params   = []

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

fn app_over(store: &Path) -> ExperimentApp {
    ExperimentApp::with_experiments(Box::new(EngineAdapter::new(Coco::new(store).unwrap())))
}

/// Two folders claiming one name: the second is refused, and the refusal has to
/// arrive somewhere the reader can read a whole sentence.
#[test]
fn a_refused_folder_opens_the_report_modal() {
    let dir = TempDir::new().unwrap();
    let library = dir.path().join("library");
    write_experiment(&library.join("first"), "solver");
    write_experiment(&library.join("second"), "solver");

    let mut app = app_over(&dir.path().join("store.json"));
    app.add_folder(&library);

    let Overlay::AddFolderReport { picked, outcome } = &app.ui.overlay else {
        panic!("a refusal must open the report, got {:?}", app.ui.overlay);
    };

    assert_eq!(outcome.added.len(), 1, "{outcome:?}");
    assert_eq!(outcome.refused.len(), 1, "{outcome:?}");
    assert!(
        outcome.refused[0].contains("solver"),
        "the refusal names no folder: {:?}",
        outcome.refused
    );
    assert!(
        picked.ends_with("library"),
        "the modal must say where the pick was looking: {picked}"
    );

    // The status bar keeps the part it can hold, and none of the reasons.
    let message = app
        .ui
        .transient_message
        .as_ref()
        .expect("what was registered is still reported");
    assert!(message.text.contains("Added"), "{:?}", message.text);
    assert!(
        !message.text.contains("already registered"),
        "a refusal reason reached the status bar: {:?}",
        message.text
    );
}

/// The path this change must not disturb: a clean pick still says its piece in
/// the status bar and opens nothing.
#[test]
fn a_clean_pick_opens_nothing() {
    let dir = TempDir::new().unwrap();
    let library = dir.path().join("library");
    write_experiment(&library.join("first"), "solver");
    write_experiment(&library.join("second"), "sweeper");

    let mut app = app_over(&dir.path().join("store.json"));
    app.add_folder(&library);

    assert_eq!(app.ui.overlay, Overlay::None, "{:?}", app.ui.overlay);
    let message = app
        .ui
        .transient_message
        .as_ref()
        .expect("a successful pick reports in the status bar");
    assert!(
        message.text.contains("Added 2 folders"),
        "{:?}",
        message.text
    );
}

/// A pick naming exactly one folder reports that folder's refusal as the call's
/// error rather than in the tally. Same event for the reader, so the same modal
/// has to open — this is the branch that used to be a status bar line.
#[test]
fn a_single_refused_folder_still_reports_in_the_modal() {
    let dir = TempDir::new().unwrap();
    let store = dir.path().join("store.json");
    write_experiment(&dir.path().join("original"), "solver");
    write_experiment(&dir.path().join("copy"), "solver");

    let mut app = app_over(&store);
    app.add_folder(&dir.path().join("original"));
    assert_eq!(app.ui.overlay, Overlay::None, "the first pick was fine");

    app.add_folder(&dir.path().join("copy"));

    let Overlay::AddFolderReport { picked, outcome } = &app.ui.overlay else {
        panic!(
            "a lone refusal must open the report, got {:?}",
            app.ui.overlay
        );
    };
    assert_eq!(outcome.refused.len(), 1, "{outcome:?}");
    assert!(outcome.added.is_empty(), "{outcome:?}");
    assert!(
        picked.ends_with("copy"),
        "the modal must name the folder that was picked: {picked}"
    );
}
