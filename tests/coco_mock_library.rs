//! End-to-end check of the bundled `mock/` library: registering the folders
//! and driving the engine through the mock scripts (launch, poll, bench plan,
//! fan-out). No cluster needed — the same folders the user adds by picking
//! `mock/` in the Add Folder picker.

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use coco::engine::{Coco, Status};
use tempfile::TempDir;

fn mock_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("mock")
}

/// The bundled mock folders are real experiment folders; each test run resets
/// the state the engine generated in a previous run.
fn reset_folder(folder: &Path) {
    for sub in ["runs", "report"] {
        let dir = folder.join(sub);
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
    }
}

#[test]
fn bundled_mock_library_registers_and_runs() {
    let dir = TempDir::new().unwrap();
    let mut coco = Coco::new(dir.path().join("store.json")).unwrap();

    let solver = mock_root().join("jobs/solver-gpu");
    let flaky = mock_root().join("jobs/flaky-solver");
    let failing = mock_root().join("jobs/failing-solver");
    let bench = mock_root().join("benches/nightly-benchmark");

    for folder in [&solver, &flaky, &failing, &bench] {
        reset_folder(folder);
        coco.register(folder).unwrap();
    }
    assert_eq!(coco.entities().len(), 4);

    // A healthy job lifecycle through the first polls.
    let mut render = BTreeMap::new();
    render.insert("nodes".to_owned(), "64".to_owned());
    let mut launch = BTreeMap::new();
    launch.insert("gpu".to_owned(), "0".to_owned());
    let run_id = coco.start_job(&solver, render, launch).unwrap();
    assert_eq!(
        coco.run_record(&solver, run_id).unwrap().submission_id,
        format!("slurm-{run_id}")
    );

    let poll = coco.poll_job(&solver).unwrap();
    assert_eq!(poll.changed.len(), 1, "{:?}", poll.warnings);
    let status = coco.run_record(&solver, run_id).unwrap().status;
    assert!(
        matches!(status, Status::Pending | Status::Running),
        "expected PENDING or RUNNING, got {status:?}"
    );

    // The bench plans three instances and dispatches them all at once.
    let mut bench_params = BTreeMap::new();
    bench_params.insert("sweep".to_owned(), "nightly".to_owned());
    let plan = coco.plan_bench(&bench, bench_params.clone()).unwrap();
    assert_eq!(plan.len(), 3);

    let start = coco.start_bench(&bench, bench_params).unwrap();
    assert_eq!(start.members.len(), 3);
    assert!(
        start.launch_failures.is_empty(),
        "{:?}",
        start.launch_failures
    );
}
