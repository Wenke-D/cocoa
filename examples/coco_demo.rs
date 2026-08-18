//! A runnable walkthrough of the coco convention.
//!
//! Builds a demo experiment folder (a job and a bench) in a temporary
//! directory, registers it, starts a run, polls it through `COMPLETED`,
//! generates its report, and runs a bench fan-out with a failed dispatch —
//! printing every step to stdout.
//!
//! ```bash
//! cargo run --example coco_demo
//! ```

use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use coco::engine::{Coco, ReportMode, Trigger};
use tempfile::TempDir;

fn main() {
    let dir = TempDir::new().expect("temp dir");
    let job = job_folder(dir.path(), "solver-gpu");
    let broken = broken_job_folder(dir.path(), "broken-job");
    let bench = bench_folder(dir.path(), "nightly-benchmark");

    let mut coco = Coco::new(dir.path().join("store.json")).expect("engine");
    coco.register(&job).expect("register job");
    coco.register(&broken).expect("register broken job");
    coco.register(&bench).expect("register bench");

    println!("== entities ==");
    for view in coco.entities() {
        match &view.manifest {
            Ok(manifest) => println!(
                "  {} {} ({})",
                manifest.kind().label(),
                manifest.name(),
                view.path.display()
            ),
            Err(error) => println!("  broken {}", error),
        }
    }

    let mut render = BTreeMap::new();
    render.insert("size".to_owned(), "256".to_owned());
    let mut launch = BTreeMap::new();
    launch.insert("gpu".to_owned(), "0".to_owned());

    println!("\n== job start ==");
    let run_id = coco
        .start_job(&job, render, launch, Trigger::Human)
        .expect("start job");
    println!(
        "  run {run_id} starting, submission {}",
        status(&coco, &job, run_id).submission_id
    );

    println!("\n== poll and report ==");
    fs::write(job.join("poll-state"), "RUNNING").unwrap();
    poll_and_print(&mut coco, &job, run_id);
    fs::write(job.join("poll-state"), "COMPLETED").unwrap();
    poll_and_print(&mut coco, &job, run_id);
    coco.report_run(&job, run_id, ReportMode::Auto)
        .expect("auto report");
    println!(
        "  run {run_id}: {} (report: {})",
        status(&coco, &job, run_id).status.label(),
        job.join("report").join(format!("{run_id}.txt")).display()
    );

    println!("\n== bench fan-out ==");
    let mut bench_params = BTreeMap::new();
    bench_params.insert("mesh".to_owned(), "fine".to_owned());
    let start = coco
        .start_bench(&bench, bench_params, Trigger::Human)
        .expect("start bench");
    println!(
        "  bench run {}: {} member(s), {} launch failure(s)",
        start.run_id,
        start.members.len(),
        start.launch_failures.len()
    );
    for failure in &start.launch_failures {
        println!("  failed dispatch: {} — {}", failure.job, failure.error);
    }
    for member in &start.members {
        println!(
            "  member run {} of {}: {}",
            member.run_id,
            member.job,
            status(&coco, &job, member.run_id).status.label()
        );
    }

    println!("\n== bench cancellation ==");
    let cancels = coco
        .cancel_bench(&bench, start.run_id)
        .expect("cancel bench");
    for cancel in &cancels {
        println!(
            "  member run {} ({}) cancelled: {}",
            cancel.run_id,
            cancel.job,
            if cancel.ok {
                "ok"
            } else {
                cancel.error.as_deref().unwrap_or("failed")
            }
        );
    }

    println!(
        "\nstore: {}\nartifacts kept under: {}",
        coco.store_path().display(),
        job.join("runs").display()
    );
}

fn poll_and_print(coco: &mut Coco, job: &Path, run_id: u64) {
    match coco.poll_job(job) {
        Ok(report) => {
            println!(
                "  poll: {} -> {}",
                run_id,
                status(coco, job, run_id).status.label()
            );
            for warning in report.warnings {
                println!("  warning: {warning}");
            }
        }
        Err(error) => println!("  poll failed loudly: {error}"),
    }
}

fn status(coco: &Coco, job: &Path, run_id: u64) -> coco::engine::RunRecord {
    coco.run_record(job, run_id).expect("record")
}

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

fn job_folder(dir: &Path, name: &str) -> std::path::PathBuf {
    let folder = dir.join(name);
    fs::create_dir_all(&folder).unwrap();
    write(
        &folder,
        "coco.toml",
        &format!(
            r#"
kind        = "job"
name        = "{name}"
description = "GPU solver sweep"

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
echo "submitting $run"
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
[ -f poll-state ] && status=$(cat poll-state)
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
mkdir -p report
echo "solver run $run finished" > "report/$run.txt"
"#,
    );
    write_script(&folder, "cancel.sh", "exit 0\n");
    folder
}

/// A registered job whose launch always fails — the fan-out keeps going.
fn broken_job_folder(dir: &Path, name: &str) -> std::path::PathBuf {
    let folder = job_folder(dir, name);
    write_script(
        &folder,
        "launch.sh",
        "echo 'ssh: connect to host cluster: timed out' >&2\nexit 1\n",
    );
    folder
}

fn bench_folder(dir: &Path, name: &str) -> std::path::PathBuf {
    let folder = dir.join(name);
    fs::create_dir_all(&folder).unwrap();
    write(
        &folder,
        "coco.toml",
        r#"
kind = "bench"
name = "nightly-benchmark"

[plan]
command = "./plan.sh"
params = ["mesh"]

[report]
command = "./report.py"
"#,
    );
    write_script(
        &folder,
        "plan.sh",
        r#"
echo 'COCO_RETURN: {"job": "solver-gpu", "params": {"size": "256", "gpu": "0"}}'
echo 'COCO_RETURN: {"job": "broken-job", "params": {"size": "512", "gpu": "1"}}'
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
mkdir -p report
echo "bench summary $run" > "report/$run.txt"
"#,
    );
    folder
}
