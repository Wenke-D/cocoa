//! Exercises the adapter the workbench renders from
//! (`Experiments` → `CocoAdapter` → coco engine).

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use chrono::Local;

use experiment_manager::adapter::{CancelTarget, CocoAdapter, Experiments};
use experiment_manager::coco::Coco;
use experiment_manager::view_model::{EntityKind, RunId, RunStatus};
use tempfile::TempDir;

fn copy_dir(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let to = dst.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &to);
        } else {
            fs::copy(entry.path(), &to).unwrap();
        }
    }
}

#[test]
fn coco_backend_drives_the_workbench_model() {
    let dir = TempDir::new().unwrap();
    let solver = dir.path().join("solver-gpu");
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("mock/jobs/solver-gpu"),
        &solver,
    );
    // The repo's mock folder may carry state from other test runs.
    for sub in ["runs", "report"] {
        let dir = solver.join(sub);
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    let mut experiments = CocoAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
    experiments.register_folder(&solver).unwrap();

    let snapshot = experiments.snapshot();
    let entity = snapshot
        .entities
        .iter()
        .find(|entity| entity.name == "solver-gpu")
        .expect("registered entity is listed");
    assert_eq!(entity.kind, EntityKind::Job);
    assert_eq!(entity.parameter_names, ["nodes", "gpu"]);
    assert!(snapshot.job_runs.is_empty());

    let mut params = BTreeMap::new();
    params.insert("nodes".to_owned(), "64".to_owned());
    params.insert("gpu".to_owned(), "0".to_owned());
    let entity_id = entity.id.clone();
    let run_id = experiments.start(&entity_id, params).unwrap();

    let snapshot = experiments.snapshot();
    let run = snapshot.job_run(&run_id).unwrap();
    assert_eq!(run.parameters, "--gpu 0 --nodes 64");
    assert_eq!(run.status, RunStatus::Starting);

    // The Job overview reads the history index, not the run map: a started run
    // must appear in both its history and its active runs, or the page the
    // start lands on looks empty.
    let history: Vec<&RunId> = snapshot
        .job_history(&entity_id)
        .map(|run| &run.id)
        .collect();
    assert_eq!(history, [&run_id], "the run is missing from the history");
    assert_eq!(
        snapshot.active_runs_of(&entity_id).count(),
        1,
        "the run is missing from the active runs"
    );

    // An automatic tick polls the folder through its mock script.
    experiments.tick(Local::now());
    let snapshot = experiments.snapshot();
    let run = snapshot.job_run(&run_id).unwrap();
    assert!(
        matches!(run.status, RunStatus::Pending | RunStatus::Running),
        "expected PENDING or RUNNING after the first poll, got {:?}",
        run.status
    );

    // Cancel goes through the folder's cancel script.
    experiments
        .cancel(CancelTarget::JobRun(run_id.clone()))
        .unwrap();
    let snapshot = experiments.snapshot();
    assert_eq!(
        snapshot.job_run(&run_id).unwrap().status,
        RunStatus::Cancelling
    );
}

/// Adding a folder is one pick in the operating system's folder picker, so a
/// directory that holds experiment folders must register all of them — this is
/// how the bundled `mock/` library is added, and how it is tested.
#[test]
fn picking_a_parent_directory_registers_the_folders_beneath_it() {
    let dir = TempDir::new().unwrap();
    let library = dir.path().join("library");
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("mock"),
        &library,
    );

    let mut experiments = CocoAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
    let outcome = experiments.register_folder(&library).unwrap();

    assert_eq!(outcome.added.len(), 4, "{outcome:?}");
    assert!(outcome.refused.is_empty(), "{outcome:?}");
    let snapshot = experiments.snapshot();
    let names: Vec<&str> = snapshot
        .entities
        .iter()
        .map(|entity| entity.name.as_str())
        .collect();
    for expected in [
        "solver-gpu",
        "flaky-solver",
        "failing-solver",
        "nightly-benchmark",
    ] {
        assert!(
            names.contains(&expected),
            "{expected} missing from {names:?}"
        );
    }

    // The same pick again adds nothing and refuses nothing.
    let outcome = experiments.register_folder(&library).unwrap();
    assert!(outcome.added.is_empty(), "{outcome:?}");
    assert_eq!(outcome.already_registered, 4, "{outcome:?}");
    assert!(outcome.refused.is_empty(), "{outcome:?}");
}

/// A picked directory with no manifest anywhere below it still joins the
/// Library, showing its manifest error (specification §11.5).
#[test]
fn picking_a_directory_without_a_manifest_registers_it_as_invalid() {
    let dir = TempDir::new().unwrap();
    let empty = dir.path().join("not-an-experiment");
    fs::create_dir_all(empty.join("notes")).unwrap();

    let mut experiments = CocoAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
    let outcome = experiments.register_folder(&empty).unwrap();

    assert_eq!(outcome.added, ["not-an-experiment"], "{outcome:?}");
    let snapshot = experiments.snapshot();
    let entity = snapshot
        .entities
        .iter()
        .find(|entity| entity.name == "not-an-experiment")
        .expect("an unusable folder stays visible");
    assert!(!entity.manifest.is_valid(), "{:?}", entity.manifest);
}
