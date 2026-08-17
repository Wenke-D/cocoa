//! Exercises the snapshot adapter the workbench UI renders from
//! (`ExperimentBackend` → `CocoBackend` → coco engine).

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use chrono::Local;

use experiment_manager::backend::{CancelTarget, CocoBackend, ExperimentBackend};
use experiment_manager::coco::Coco;
use experiment_manager::model::{EntityKind, RunStatus};
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

    let mut backend = CocoBackend::new(Coco::new(dir.path().join("store.json")).unwrap());
    backend.register_folder(&solver).unwrap();

    let snapshot = backend.snapshot();
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
    let run_id = backend.start(&entity.id.clone(), params).unwrap();

    let snapshot = backend.snapshot();
    let run = snapshot.job_run(&run_id).unwrap();
    assert_eq!(run.parameters, "--gpu 0 --nodes 64");
    assert_eq!(run.status, RunStatus::Starting);

    // An automatic tick polls the folder through its mock script.
    backend.tick(Local::now());
    let snapshot = backend.snapshot();
    let run = snapshot.job_run(&run_id).unwrap();
    assert!(
        matches!(run.status, RunStatus::Pending | RunStatus::Running),
        "expected PENDING or RUNNING after the first poll, got {:?}",
        run.status
    );

    // Cancel goes through the folder's cancel script.
    backend
        .cancel(CancelTarget::JobRun(run_id.clone()))
        .unwrap();
    let snapshot = backend.snapshot();
    assert_eq!(
        snapshot.job_run(&run_id).unwrap().status,
        RunStatus::Cancelling
    );
}
