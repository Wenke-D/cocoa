//! Exercises the adapter the workbench renders from
//! (`Experiments` → `EngineAdapter` → coco engine).

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use chrono::Local;

use coco::adapter::{CancelTarget, EngineAdapter, Experiments};
use coco::engine::Coco;
use coco::view_model::{EntityKind, RunId, RunStatus, Trigger};
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
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../mock/jobs/solver-gpu"),
        &solver,
    );
    // The repo's mock folder may carry state from other test runs.
    for sub in ["runs", "report"] {
        let dir = solver.join(sub);
        if dir.exists() {
            fs::remove_dir_all(&dir).unwrap();
        }
    }

    let mut experiments = EngineAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
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
    let run_id = experiments
        .start(&entity_id, params, Trigger::Human)
        .unwrap();

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

    // An automatic tick collects the launch and polls the folder through its
    // mock script. The launch script runs in its own time (§7.1), so this
    // ticks until the poll has something to say.
    let mut status = RunStatus::Starting;
    for tick in 1..=200 {
        experiments.tick(Local::now() + chrono::TimeDelta::seconds(4 * tick));
        status = experiments.snapshot().job_run(&run_id).unwrap().status;
        if !matches!(status, RunStatus::Starting) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    assert!(
        matches!(status, RunStatus::Pending | RunStatus::Running),
        "expected PENDING or RUNNING once the poll ran, got {status:?}"
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
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../mock"),
        &library,
    );

    let mut experiments = EngineAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
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

/// A picked directory with no manifest anywhere below it is refused, and
/// nothing joins the Explorer (specification §11.5).
///
/// Registering it would turn one mis-picked directory into a permanent broken
/// row that the user never chose to have.
#[test]
fn picking_a_directory_without_a_manifest_is_refused() {
    let dir = TempDir::new().unwrap();
    let empty = dir.path().join("not-an-experiment");
    fs::create_dir_all(empty.join("notes")).unwrap();

    let mut experiments = EngineAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
    let error = experiments.register_folder(&empty).unwrap_err();

    assert!(
        error.to_string().contains("coco.toml"),
        "the refusal must say what was missing: {error}"
    );
    assert!(
        experiments.snapshot().entities.is_empty(),
        "a refused folder joined the Explorer anyway"
    );
}

/// The other half of that rule: a folder that registered while its manifest was
/// good stays listed once the manifest breaks, carrying the error
/// (specification §11.5).
///
/// The user knows this entity and has run it. Dropping it out of the Explorer
/// the moment someone mistypes its manifest would hide both the entity and the
/// mistake.
#[test]
fn an_entity_whose_manifest_breaks_later_stays_listed() {
    let dir = TempDir::new().unwrap();
    let library = dir.path().join("library");
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../mock"),
        &library,
    );

    let mut experiments = EngineAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
    experiments.register_folder(&library).unwrap();
    assert!(
        experiments
            .snapshot()
            .entities
            .iter()
            .any(|entity| entity.name == "solver-gpu" && entity.manifest.is_valid()),
        "the fixture did not register cleanly"
    );

    fs::write(
        library.join("jobs/solver-gpu/coco.toml"),
        "kind = \"job\"\nname = \"solver-gpu\"\n",
    )
    .unwrap();

    // The adapter serves a cached world; a manifest edited behind its back
    // surfaces on the next refresh, which is what the workbench's own Refresh
    // and its polling both do.
    experiments.refresh().unwrap();

    let snapshot = experiments.snapshot();
    let entity = snapshot
        .entities
        .iter()
        .find(|entity| entity.name == "solver-gpu")
        .expect("a registered entity must survive its manifest breaking");
    assert!(!entity.manifest.is_valid(), "{:?}", entity.manifest);
}

/// A run outlives the Bench that dispatched it (specification §10.6).
///
/// The origin used to be reconstructed at read time by finding the Bench by
/// name and scanning its members, with `unwrap_or(0)` when that failed — so a
/// run whose Bench had left the Explorer reported "call 0" with confidence.
/// Recorded at dispatch, it keeps the name and the call and only loses the link.
#[test]
fn a_run_keeps_its_origin_when_its_bench_leaves_the_explorer() {
    use coco::view_model::RunOrigin;

    let dir = TempDir::new().unwrap();
    let library = dir.path().join("library");
    copy_dir(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("../mock"),
        &library,
    );

    let mut experiments = EngineAdapter::new(Coco::new(dir.path().join("store.json")).unwrap());
    experiments.register_folder(&library).unwrap();

    let bench = experiments
        .snapshot()
        .entities
        .iter()
        .find(|entity| entity.name == "nightly-benchmark")
        .cloned()
        .expect("the bundled bench registered");
    let parameters = bench
        .parameter_names
        .iter()
        .map(|name| (name.clone(), "1".to_owned()))
        .collect();
    experiments
        .start(&bench.id, parameters, Trigger::Human)
        .unwrap();

    let dispatched = |experiments: &EngineAdapter| {
        experiments
            .snapshot()
            .job_runs
            .values()
            .find(|run| !run.origin.is_direct())
            .cloned()
            .expect("the bench dispatched something")
    };

    let before = dispatched(&experiments);
    let RunOrigin::Bench { name, call, .. } = &before.origin else {
        panic!("expected a dispatched run, got {:?}", before.origin);
    };
    assert_eq!(name, "nightly-benchmark");
    assert!(*call >= 1, "calls count from 1, got {call}");
    let (name, call) = (name.clone(), *call);

    // The Bench folder goes away; its dispatched runs stay in their Job.
    fs::remove_dir_all(library.join("benches/nightly-benchmark")).unwrap();
    experiments.refresh().ok();

    let after = dispatched(&experiments);
    match &after.origin {
        RunOrigin::Bench {
            name: still,
            bench_id,
            call: still_call,
            ..
        } => {
            assert_eq!(still, &name, "the name it was dispatched under is recorded");
            assert_eq!(still_call, &call, "and so is the call");
            assert!(bench_id.is_none(), "there is nowhere left to link to");
        }
        other => panic!("the run forgot what dispatched it: {other:?}"),
    }
}
