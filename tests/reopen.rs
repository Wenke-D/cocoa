//! What a closed coco misses, and catches up on (specification §10).
//!
//! coco cannot watch a cluster it is not running to watch. What it must do
//! instead is notice, on the way back up, that the world moved without it: a run
//! that was in flight when the window closed has finished, and the stage that
//! follows — the report — still has to happen.

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use coco::engine::{Coco, Trigger};
use tempfile::TempDir;

fn script(folder: &Path, name: &str, body: &str) {
    let path = folder.join(name);
    fs::write(&path, body).unwrap();
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&path, permissions).unwrap();
}

fn params(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

/// A job whose poll answers out of a file, so the "cluster" can move on while
/// coco is not running.
fn job_with_scriptable_poll(dir: &TempDir) -> std::path::PathBuf {
    let job = dir.path().join("solver");
    fs::create_dir_all(&job).unwrap();

    script(&job, "job.tmpl", "#!/bin/sh\necho {{ size }}\n");
    script(&job, "launch.sh", "#!/bin/sh\necho 'COCO_RETURN: sub-1'\n");
    script(
        &job,
        "poll.sh",
        "#!/bin/sh\ncat \"$(dirname \"$0\")/state\"\n",
    );
    script(
        &job,
        "report.sh",
        "#!/bin/sh\n\
         run=\"\"\n\
         while [ $# -gt 0 ]; do case \"$1\" in --run) run=\"$2\"; shift 2;; *) shift;; esac; done\n\
         mkdir -p \"$(dirname \"$0\")/report\"\n\
         echo body > \"$(dirname \"$0\")/report/$run.txt\"\n",
    );
    script(&job, "cancel.sh", "#!/bin/sh\necho ok\n");

    fs::write(
        job.join("coco.toml"),
        r#"
kind     = "job"
name     = "solver"

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
"#,
    )
    .unwrap();

    job
}

/// Close coco over a running job, let the cluster finish it, open coco again:
/// the run must settle and its report must have been produced, without anyone
/// pressing anything.
#[test]
fn a_run_that_finished_while_coco_was_closed_settles_on_reopen() {
    let dir = TempDir::new().unwrap();
    let job = job_with_scriptable_poll(&dir);
    let store = dir.path().join("store.json");
    fs::write(job.join("state"), "COCO_RETURN: sub-1 RUNNING\n").unwrap();

    let run_id = {
        let mut coco = Coco::new(&store).unwrap();
        coco.register(&job).unwrap();
        coco.start_job(&job, params(&[("size", "1")]), params(&[]), Trigger::Human)
            .unwrap()
    };
    // The window closes here: nothing of coco is left running.

    fs::write(job.join("state"), "COCO_RETURN: sub-1 COMPLETED\n").unwrap();

    let mut coco = Coco::new(&store).unwrap();
    let refreshed = coco.refresh();

    assert!(refreshed.poll_errors.is_empty(), "{refreshed:?}");
    assert!(refreshed.report_errors.is_empty(), "{refreshed:?}");

    let runs = coco.job_runs(&job).unwrap();
    let record = runs[0].record.as_ref().expect("the run record survived");
    assert_eq!(
        record.status,
        coco::engine::Status::Succeeded,
        "a finished run must settle on reopen, not wait to be poked"
    );
    assert!(
        job.join("report").join(format!("{run_id}.txt")).is_file(),
        "the stage that follows COMPLETED has to happen too"
    );
}
