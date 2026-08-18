//! End-to-end engine tests: real folders, real executable scripts, the whole
//! convention.
//!
//! Scripts are written to temp folders and made executable, so these tests
//! exercise the actual argv invocation path. They run on the product's
//! platforms (macOS and Linux).

#![cfg(unix)]

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use coco::engine::{Coco, ReportMode, Status, Trigger};
use tempfile::TempDir;

fn write(folder: &Path, name: &str, contents: &str) {
    fs::write(folder.join(name), contents).unwrap();
}

fn write_script(folder: &Path, name: &str, body: &str) {
    let path = folder.join(name);
    fs::write(&path, format!("#!/bin/sh\n{body}")).unwrap();
    let mut perms = fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&path, perms).unwrap();
}

fn params(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// A job folder whose `poll` reads `poll-state` (default `RUNNING`) and whose
/// `report` reads `report-state` (`ok` or `fail`).
fn job_folder(dir: &TempDir, name: &str) -> std::path::PathBuf {
    let folder = dir.path().join(name);
    fs::create_dir_all(&folder).unwrap();
    write(
        &folder,
        "coco.toml",
        &format!(
            r#"
kind        = "job"
name        = "{name}"
description = "test job"

[render]
template    = "job.sbatch.tmpl"
params      = ["size"]

[launch]
command     = "./launch.sh"
params      = ["gpu"]

[poll]
command     = "./poll.py"

[report]
command     = "./report.py"

[cancel]
command     = "./cancel.sh"
"#
        ),
    );
    write(
        &folder,
        "job.sbatch.tmpl",
        "#SBATCH --nodes={{ size }}\n./solver\n",
    );
    write_script(
        &folder,
        "launch.sh",
        r#"
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "submitting run $run"
echo "COCO_RETURN: sub-$run"
"#,
    );
    write_script(
        &folder,
        "poll.py",
        r#"
subs=""
while [ $# -gt 0 ]; do
  case "$1" in
    --submissions) subs="$2"; shift 2 ;;
    *) shift ;;
  esac
done
status="RUNNING"
if [ -f poll-state ]; then
  status=$(cat poll-state)
fi
oldifs=$IFS
IFS=,
for s in $subs; do
  echo "COCO_RETURN: $s $status"
done
IFS=$oldifs
"#,
    );
    write_script(
        &folder,
        "report.py",
        r#"
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -f report-state ] && [ "$(cat report-state)" = "fail" ]; then
  echo "report script exploded" >&2
  exit 1
fi
mkdir -p report
echo "report for run $run" > "report/$run.txt"
echo "COCO_RETURN: nothing"
"#,
    );
    write_script(&folder, "cancel.sh", "exit 0\n");
    folder
}

fn bench_folder(
    dir: &TempDir,
    name: &str,
    job_names: &[&str],
    plan_body: &str,
) -> std::path::PathBuf {
    let folder = dir.path().join(name);
    fs::create_dir_all(&folder).unwrap();
    write(
        &folder,
        "coco.toml",
        &format!(
            r#"
kind = "bench"
name = "{name}"

[plan]
command = "./plan.sh"
params = ["mesh"]

[report]
command = "./report.py"
"#
        ),
    );
    let mut lines = String::new();
    for job in job_names {
        lines.push_str(&format!(
            "echo 'COCO_RETURN: {{\"job\": \"{job}\", \"params\": {{\"size\": \"256\", \"gpu\": \"0\"}}}}'\n"
        ));
    }
    write_script(&folder, "plan.sh", &format!("{plan_body}\n{lines}"));
    write_script(
        &folder,
        "report.py",
        r#"
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p report
echo "bench report $run" > "report/$run.txt"
"#,
    );
    folder
}

fn engine(dir: &TempDir) -> Coco {
    Coco::new(dir.path().join("store.json")).unwrap()
}

#[test]
fn full_job_lifecycle() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "solver-gpu");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();

    let run_id = coco
        .start_job(
            &job,
            params(&[("size", "256")]),
            params(&[("gpu", "0")]),
            Trigger::Human,
        )
        .unwrap();

    let record = coco.run_record(&job, run_id).unwrap();
    assert_eq!(record.status, Status::Starting);
    assert_eq!(record.submission_id, format!("sub-{run_id}"));
    assert!(
        job.join("runs")
            .join(run_id.to_string())
            .join("job.sbatch")
            .is_file()
    );
    let artifact =
        fs::read_to_string(job.join("runs").join(run_id.to_string()).join("job.sbatch")).unwrap();
    assert!(artifact.contains("--nodes=256"), "{artifact}");
    assert!(coco.last_args()["solver-gpu"].contains_key("size"));

    fs::write(job.join("poll-state"), "RUNNING").unwrap();
    let report = coco.poll_job(&job).unwrap();
    assert_eq!(report.changed, [(run_id, Status::Running)]);
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Running
    );

    fs::write(job.join("poll-state"), "COMPLETED").unwrap();
    coco.poll_job(&job).unwrap();
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Completed
    );

    coco.report_run(&job, run_id, ReportMode::Auto).unwrap();
    let record = coco.run_record(&job, run_id).unwrap();
    assert_eq!(record.status, Status::Succeeded);
    assert!(job.join("report").join(format!("{run_id}.txt")).is_file());

    // A succeeded run cannot be cancelled.
    assert!(coco.cancel_run(&job, run_id).is_err());
}

#[test]
fn launch_failure_records_nothing_and_burns_the_id() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "broken-launch");
    write_script(&job, "launch.sh", "echo 'cluster refused' >&2\nexit 1\n");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();

    let err = coco
        .start_job(
            &job,
            params(&[("size", "1")]),
            params(&[("gpu", "0")]),
            Trigger::Human,
        )
        .unwrap_err();
    assert!(err.to_string().contains("cluster refused"), "{err}");

    let runs_dir = job.join("runs");
    let run_dirs: Vec<_> = fs::read_dir(&runs_dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(run_dirs.len(), 1, "artifact dir remains for inspection");
    assert!(!runs_dir.join("0").join("run.json").exists(), "no record");

    // The failed id is consumed: the next start gets id 1, never 0.
    write_script(&job, "launch.sh", "echo 'COCO_RETURN: ok-1'\n");
    let run_id = coco
        .start_job(
            &job,
            params(&[("size", "1")]),
            params(&[("gpu", "0")]),
            Trigger::Human,
        )
        .unwrap();
    assert_eq!(run_id, 1);
}

#[test]
fn poll_failure_sets_unreachable_and_returns_loud_error() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "quiet");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();
    let run_id = coco
        .start_job(
            &job,
            params(&[("size", "1")]),
            params(&[("gpu", "0")]),
            Trigger::Human,
        )
        .unwrap();

    write_script(&job, "poll.py", "echo 'squeue broke' >&2\nexit 3\n");
    let err = coco.poll_job(&job).unwrap_err();
    assert!(err.to_string().contains("squeue broke"), "{err}");

    let record = coco.run_record(&job, run_id).unwrap();
    assert_eq!(record.status, Status::Unreachable);
    assert!(
        record
            .reason
            .as_deref()
            .unwrap()
            .contains("poll script failed"),
        "{:?}",
        record.reason
    );

    // The next good poll overwrites UNREACHABLE.
    write_script(
        &job,
        "poll.py",
        "subs='' ; echo 'COCO_RETURN: UNREACHABLE never mind'\n",
    );
    coco.poll_job(&job).unwrap();
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Unreachable
    );
    write_script(&job, "poll.py", "echo 'COCO_RETURN: sub-0 RUNNING'\n");
    let report = coco.poll_job(&job).unwrap();
    assert_eq!(report.changed, [(run_id, Status::Running)]);
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Running
    );
}

#[test]
fn cancel_failure_keeps_status_and_success_moves_to_cancelling() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "cancel-me");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();
    let run_id = coco
        .start_job(
            &job,
            params(&[("size", "1")]),
            params(&[("gpu", "0")]),
            Trigger::Human,
        )
        .unwrap();
    fs::write(job.join("poll-state"), "RUNNING").unwrap();
    coco.poll_job(&job).unwrap();

    write_script(&job, "cancel.sh", "echo 'already gone' >&2\nexit 9\n");
    let err = coco.cancel_run(&job, run_id).unwrap_err();
    assert!(err.to_string().contains("already gone"), "{err}");
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Running
    );

    write_script(&job, "cancel.sh", "exit 0\n");
    coco.cancel_run(&job, run_id).unwrap();
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Cancelling
    );
}

#[test]
fn unknown_poll_status_is_ignored_with_a_warning() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "weird");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();
    let run_id = coco
        .start_job(
            &job,
            params(&[("size", "1")]),
            params(&[("gpu", "0")]),
            Trigger::Human,
        )
        .unwrap();

    write_script(&job, "poll.py", "echo 'COCO_RETURN: sub-0 HYPERDRIVE'\n");
    let report = coco.poll_job(&job).unwrap();
    assert_eq!(report.changed, []);
    assert_eq!(report.warnings.len(), 1, "{:?}", report.warnings);
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Starting
    );
}

#[test]
fn a_manifest_that_breaks_later_stays_registered_and_shown() {
    let dir = TempDir::new().unwrap();
    let folder = job_folder(&dir, "solver");

    let mut coco = engine(&dir);
    coco.register(&folder).unwrap();

    // Someone edits the manifest afterwards. The entity is one the user knows
    // and has run, so it stays listed carrying the error (specification §11.5).
    write(
        &folder,
        "coco.toml",
        "kind = \"pipeline\"\nname = \"solver\"\n",
    );

    let views = coco.entities();
    assert_eq!(views.len(), 1);
    assert!(views[0].manifest.is_err());

    let err = coco
        .start_job(&folder, params(&[]), params(&[]), Trigger::Human)
        .unwrap_err();
    assert!(err.to_string().contains("kind"), "{err}");
}

/// The other side of that rule: a manifest already broken when the folder is
/// picked never registers at all (specification §11.5).
#[test]
fn a_manifest_already_broken_is_refused_at_registration() {
    let dir = TempDir::new().unwrap();
    let folder = dir.path().join("broken");
    fs::create_dir_all(&folder).unwrap();
    write(&folder, "coco.toml", "kind = \"pipeline\"\nname = \"x\"\n");

    let mut coco = engine(&dir);
    let err = coco.register(&folder).unwrap_err();

    assert!(err.to_string().contains("kind"), "{err}");
    assert!(coco.entities().is_empty(), "a refused folder registered");
}

#[test]
fn duplicate_names_are_refused() {
    let dir = TempDir::new().unwrap();
    let first = job_folder(&dir, "same-name");
    let second = dir.path().join("elsewhere");
    fs::create_dir_all(&second).unwrap();
    let toml = fs::read_to_string(first.join("coco.toml")).unwrap();
    write(&second, "coco.toml", &toml);
    fs::copy(
        first.join("job.sbatch.tmpl"),
        second.join("job.sbatch.tmpl"),
    )
    .unwrap();
    for script in ["launch.sh", "poll.py", "report.py", "cancel.sh"] {
        fs::copy(first.join(script), second.join(script)).unwrap();
        let path = second.join(script);
        let mut perms = fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&path, perms).unwrap();
    }

    let mut coco = engine(&dir);
    coco.register(&first).unwrap();
    let err = coco.register(&second).unwrap_err();
    assert!(err.to_string().contains("already registered"), "{err}");
}

#[test]
fn bench_fanout_records_members_and_launch_failures() {
    let dir = TempDir::new().unwrap();
    let good = job_folder(&dir, "good-job");
    let bad = job_folder(&dir, "bad-job");
    write_script(&bad, "launch.sh", "echo 'no capacity' >&2\nexit 1\n");
    let bench = bench_folder(&dir, "sweep", &["good-job", "bad-job"], "");

    let mut coco = engine(&dir);
    coco.register(&good).unwrap();
    coco.register(&bad).unwrap();
    coco.register(&bench).unwrap();

    let start = coco
        .start_bench(&bench, params(&[("mesh", "fine")]), Trigger::Human)
        .unwrap();
    assert_eq!(start.members.len(), 1);
    assert_eq!(start.launch_failures.len(), 1);
    assert_eq!(start.launch_failures[0].job, "bad-job");

    let member = coco.run_record(&good, start.members[0].run_id).unwrap();
    assert_eq!(
        member.origin,
        coco::engine::RunOrigin::Bench {
            run_id: start.run_id,
            name: "sweep".to_owned(),
            call: 1,
        },
        "a dispatched run records which bench run and which call dispatched it"
    );

    // The bench never became what the plan asked for: ERROR, eventually.
    fs::write(good.join("poll-state"), "COMPLETED").unwrap();
    coco.poll_job(&good).unwrap();
    coco.report_run(&good, start.members[0].run_id, ReportMode::Auto)
        .unwrap();
    let status = coco.bench_status(&bench, start.run_id).unwrap();
    assert_eq!(status.status, Status::Error);
    assert_eq!(status.succeeded, 1);
}

#[test]
fn bench_report_requires_every_member_succeeded() {
    let dir = TempDir::new().unwrap();
    let good = job_folder(&dir, "ok-job");
    let bench = bench_folder(&dir, "nightly", &["ok-job"], "");
    let mut coco = engine(&dir);
    coco.register(&good).unwrap();
    coco.register(&bench).unwrap();
    let start = coco
        .start_bench(&bench, params(&[("mesh", "fine")]), Trigger::Human)
        .unwrap();

    fs::write(good.join("poll-state"), "FAILED no convergence").unwrap();
    coco.poll_job(&good).unwrap();
    let status = coco.bench_status(&bench, start.run_id).unwrap();
    assert_eq!(status.status, Status::Failed);
    assert_eq!(status.failed, 1);

    let err = coco
        .bench_report(&bench, start.run_id, ReportMode::Auto)
        .unwrap_err();
    assert!(err.to_string().contains("no bench report"), "{err}");
    assert!(
        !bench
            .join("report")
            .join(format!("{}.txt", start.run_id))
            .exists()
    );
}

#[test]
fn bench_reports_when_every_member_succeeded() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "sweep-job");
    let bench = bench_folder(&dir, "nightly", &["sweep-job"], "");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();
    coco.register(&bench).unwrap();
    let start = coco
        .start_bench(&bench, params(&[("mesh", "fine")]), Trigger::Human)
        .unwrap();

    let status = coco.bench_status(&bench, start.run_id).unwrap();
    assert_eq!(status.status, Status::Starting);

    fs::write(job.join("poll-state"), "COMPLETED").unwrap();
    coco.poll_job(&job).unwrap();
    coco.report_run(&job, start.members[0].run_id, ReportMode::Auto)
        .unwrap();
    let status = coco.bench_status(&bench, start.run_id).unwrap();
    assert_eq!(status.status, Status::Analyzing);

    coco.bench_report(&bench, start.run_id, ReportMode::Auto)
        .unwrap();
    let status = coco.bench_status(&bench, start.run_id).unwrap();
    assert_eq!(status.status, Status::Succeeded);
    assert!(
        bench
            .join("runs")
            .join(start.run_id.to_string())
            .join("members.json")
            .is_file()
    );
    assert!(
        bench
            .join("report")
            .join(format!("{}.txt", start.run_id))
            .is_file()
    );
}

/// A plan is generated, so its mistakes arrive in batches. Every call is
/// checked and every bad one is named, rather than the user fixing one, starting
/// again, and meeting the next (convention §8.1).
#[test]
fn every_bad_plan_call_is_reported_at_once() {
    let dir = TempDir::new().unwrap();
    let good = job_folder(&dir, "good-job");
    let bench = bench_folder(&dir, "sweep", &["good-job"], "");
    write_script(
        &bench,
        "plan.sh",
        concat!(
            "echo 'COCO_RETURN: {\"job\": \"ghost\", \"params\": {}}'\n",
            "echo 'COCO_RETURN: {\"job\": \"good-job\", \"params\": {\"size\": \"1\", \"gpu\": \"0\"}}'\n",
            "echo 'COCO_RETURN: {\"job\": \"phantom\", \"params\": {}}'\n",
            "echo 'COCO_RETURN: {\"job\": \"good-job\", \"params\": {\"size\": \"1\"}}'\n",
        ),
    );
    let mut coco = engine(&dir);
    coco.register(&good).unwrap();
    coco.register(&bench).unwrap();

    let err = coco
        .start_bench(&bench, params(&[("mesh", "fine")]), Trigger::Human)
        .unwrap_err();
    let message = err.to_string();

    // Three of the four calls are bad, and all three are named — including the
    // last, which an abort-on-first check would never have reached.
    assert!(message.contains("3 of 4"), "{message}");
    assert!(message.contains("call 1"), "{message}");
    assert!(message.contains("call 3"), "{message}");
    assert!(message.contains("call 4"), "{message}");
    assert!(
        !message.contains("call 2"),
        "the good call was named: {message}"
    );
    assert!(coco.bench_runs(&bench).unwrap().is_empty());
}

#[test]
fn plan_failure_dispatches_nothing() {
    let dir = TempDir::new().unwrap();
    let bench = bench_folder(&dir, "broken-plan", &[], "");
    write_script(
        &bench,
        "plan.sh",
        "echo 'COCO_RETURN: {\"job\": \"ghost\", \"params\": {}}'\n",
    );
    let mut coco = engine(&dir);
    coco.register(&bench).unwrap();

    let err = coco
        .start_bench(&bench, params(&[("mesh", "fine")]), Trigger::Human)
        .unwrap_err();
    assert!(err.to_string().contains("not a registered job"), "{err}");
    assert!(coco.bench_runs(&bench).unwrap().is_empty());
}

#[test]
fn manual_report_heals_a_failed_auto_report() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "flaky-report");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();
    let run_id = coco
        .start_job(
            &job,
            params(&[("size", "1")]),
            params(&[("gpu", "0")]),
            Trigger::Human,
        )
        .unwrap();
    fs::write(job.join("poll-state"), "COMPLETED").unwrap();
    coco.poll_job(&job).unwrap();

    fs::write(job.join("report-state"), "fail").unwrap();
    let err = coco.report_run(&job, run_id, ReportMode::Auto).unwrap_err();
    assert!(err.to_string().contains("exploded"), "{err}");
    let record = coco.run_record(&job, run_id).unwrap();
    assert_eq!(record.status, Status::Error);
    assert!(record.error.as_deref().unwrap().contains("exploded"));

    fs::remove_file(job.join("report-state")).unwrap();
    coco.report_run(&job, run_id, ReportMode::Manual).unwrap();
    assert_eq!(
        coco.run_record(&job, run_id).unwrap().status,
        Status::Succeeded
    );
    assert!(job.join("report").join(format!("{run_id}.txt")).is_file());
}

#[test]
fn corrupt_run_json_fails_only_that_run() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "mixed-history");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();
    coco.start_job(
        &job,
        params(&[("size", "1")]),
        params(&[("gpu", "0")]),
        Trigger::Human,
    )
    .unwrap();
    coco.start_job(
        &job,
        params(&[("size", "2")]),
        params(&[("gpu", "1")]),
        Trigger::Human,
    )
    .unwrap();

    fs::write(job.join("runs/0/run.json"), "{ not json").unwrap();
    let views = coco.job_runs(&job).unwrap();
    assert_eq!(views.len(), 2);
    assert!(
        views
            .iter()
            .find(|v| v.run_id == 0)
            .unwrap()
            .record
            .is_err()
    );
    assert!(views.iter().find(|v| v.run_id == 1).unwrap().record.is_ok());
}

/// Every declared parameter must be supplied by hand (convention §2.1). The
/// start form sends one entry per declared name whether or not the user typed
/// in it, so a present-but-blank value must be refused exactly like a missing
/// one — otherwise a job launches with no arguments at all.
#[test]
fn blank_parameter_values_are_refused() {
    let dir = TempDir::new().unwrap();
    let job = job_folder(&dir, "solver-gpu");
    let mut coco = engine(&dir);
    coco.register(&job).unwrap();

    // Every field left empty, which is what an untouched start form sends.
    let err = coco
        .start_job(
            &job,
            params(&[("size", "")]),
            params(&[("gpu", "")]),
            Trigger::Human,
        )
        .unwrap_err();
    assert!(err.to_string().contains("size"), "{err}");

    // One field filled, the other blank or whitespace.
    let err = coco
        .start_job(
            &job,
            params(&[("size", "256")]),
            params(&[("gpu", "  ")]),
            Trigger::Human,
        )
        .unwrap_err();
    assert!(err.to_string().contains("gpu"), "{err}");

    // Nothing was launched, and no run id was burned on a refused start.
    assert!(!job.join("runs").exists(), "a refused start wrote a run");

    // The same start with real values goes through.
    coco.start_job(
        &job,
        params(&[("size", "256")]),
        params(&[("gpu", "0")]),
        Trigger::Human,
    )
    .unwrap();
}
