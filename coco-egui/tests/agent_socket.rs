//! The agent interface, exercised without a window (specification §37).
//!
//! The parts worth pinning down are the ones a running coco would make hard to
//! reach: what happens to a socket file the last window left behind, what a
//! second coco does when the first still owns it, and what each route answers.
//! For the route tests the worker is stood in for by a thread that drains the
//! bridge, which is exactly what `coco::worker::Worker` does once a pass; one
//! test runs the real worker end to end.

#![cfg(unix)]

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::sync::Arc;
use std::time::Duration;

use coco::agent::http::Request;
use coco::agent::{Bridge, Reply, Server};

/// Unix socket paths are bounded (`SUN_LEN`), and a temp dir under a long home
/// blows the limit — so these bind under `/tmp` with a name of their own.
fn socket_path(name: &str) -> std::path::PathBuf {
    let path = std::path::PathBuf::from(format!("/tmp/coco-test-{name}.sock"));
    let _ = std::fs::remove_file(&path);
    path
}

fn request(method: &str, path: &str, body: &str) -> Request {
    Request {
        method: method.to_owned(),
        path: path.to_owned(),
        body: body.as_bytes().to_vec(),
    }
}

fn get(path: &str) -> Request {
    request("GET", path, "")
}

fn post(path: &str, body: &str) -> Request {
    request("POST", path, body)
}

/// Stands in for the worker: drains what the socket queued, answers it.
fn drain_with(
    bridge: Arc<Bridge>,
    answer: impl Fn(coco::agent::Request) -> Result<Reply, String> + Send + 'static,
) {
    std::thread::spawn(move || {
        for _ in 0..200 {
            for pending in bridge.take_pending() {
                let _ = pending.reply.send(answer(pending.request));
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    });
}

#[test]
fn a_socket_file_left_by_a_crash_is_replaced() {
    let path = socket_path("stale");
    // A file with nothing listening behind it — what a killed coco leaves.
    std::fs::write(&path, b"").unwrap();
    assert!(path.exists());

    let server = Server::start(path.clone(), Bridge::new()).expect("a stale file is not an owner");
    assert!(path.exists(), "the socket was rebound");
    drop(server);
    assert!(!path.exists(), "closing coco takes its socket with it");
}

/// Two windows would be two owners of one store, which is the situation the
/// whole design exists to avoid.
#[test]
fn a_second_coco_is_refused_while_the_first_is_listening() {
    let path = socket_path("occupied");
    let first = UnixListener::bind(&path).unwrap();

    let error = Server::start(path.clone(), Bridge::new())
        .expect_err("the second window must not steal the socket");
    assert_eq!(error.kind(), std::io::ErrorKind::AddrInUse, "{error}");

    drop(first);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn the_world_is_served_as_the_window_last_saw_it() {
    let bridge = Bridge::new();
    let response = coco::agent::route(&get("/world"), &bridge);

    assert_eq!(response.status, 200);
    let world: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert!(world.get("entities").is_some(), "{}", response.body);
}

#[test]
fn a_start_reaches_the_frame_loop_and_comes_back_with_a_run_id() {
    let bridge = Bridge::new();
    drain_with(Arc::clone(&bridge), |request| match request {
        coco::agent::Request::Start {
            experiment,
            parameters,
        } => {
            assert_eq!(experiment, "solver-gpu");
            assert_eq!(parameters.get("nodes").map(String::as_str), Some("64"));
            Ok(Reply::Started {
                run_id: "7".to_owned(),
            })
        }
    });

    let response = coco::agent::route(
        &post(
            "/experiments/solver-gpu/runs",
            r#"{"parameters": {"nodes": "64"}}"#,
        ),
        &bridge,
    );

    assert_eq!(response.status, 201, "{}", response.body);
    assert_eq!(response.body, r#"{"run_id":"7"}"#);
}

/// The workbench's own refusal, carried through unchanged.
#[test]
fn a_refused_start_answers_with_the_reason_a_person_would_have_seen() {
    let bridge = Bridge::new();
    drain_with(Arc::clone(&bridge), |_| {
        Err("This experiment requires a parameter string.".to_owned())
    });

    let response = coco::agent::route(&post("/experiments/solver-gpu/runs", "{}"), &bridge);

    assert_eq!(response.status, 400, "{}", response.body);
    assert!(
        response.body.contains("requires a parameter string"),
        "{}",
        response.body
    );
}

#[test]
fn an_unknown_experiment_is_a_404() {
    let bridge = Bridge::new();
    drain_with(Arc::clone(&bridge), |_| {
        Err("No such entity: ghost".to_owned())
    });

    let response = coco::agent::route(&post("/experiments/ghost/runs", "{}"), &bridge);
    assert_eq!(response.status, 404, "{}", response.body);
}

#[test]
fn unknown_routes_and_methods_are_told_so() {
    let bridge = Bridge::new();
    assert_eq!(coco::agent::route(&get("/nope"), &bridge).status, 404);
    assert_eq!(
        coco::agent::route(&request("DELETE", "/world", ""), &bridge).status,
        405
    );
}

/// A wedged window must not hang the caller for ever.
#[test]
fn a_window_that_never_answers_times_out() {
    let bridge = Bridge::new();
    let started = std::time::Instant::now();
    let result = bridge.submit(
        coco::agent::Request::Start {
            experiment: "solver-gpu".to_owned(),
            parameters: Default::default(),
        },
        Duration::from_millis(50),
    );
    assert!(result.is_err(), "nothing drained it, so it cannot have run");
    assert!(started.elapsed() < Duration::from_secs(5));
}

/// A world with one Job (one run, report ready) and one Bench (one run that
/// dispatched that Job), for the read routes to answer from.
fn seeded_bridge() -> Arc<Bridge> {
    use coco::view_model::{
        BenchPlan, BenchPlanStep, BenchRun, Entity, EntityId, EntityKind, JobRun, ManifestState,
        QueryHealth, ReportFormat, ReportState, RunId, RunOrigin, RunStatus, Snapshot, Trigger,
        World,
    };

    let job_id = EntityId::new("/tmp/lab/solver");
    let bench_id = EntityId::new("/tmp/lab/sweep");
    let mut world = World {
        entities: vec![
            Entity {
                id: job_id.clone(),
                kind: EntityKind::Job,
                name: "solver".to_owned(),
                path: "~/lab/solver".to_owned(),
                manifest: ManifestState::Valid,
                parameter_names: vec!["size".to_owned()],
                last_used: Default::default(),
            },
            Entity {
                id: bench_id.clone(),
                kind: EntityKind::Bench,
                name: "sweep".to_owned(),
                path: "~/lab/sweep".to_owned(),
                manifest: ManifestState::Valid,
                parameter_names: vec!["mesh".to_owned()],
                last_used: Default::default(),
            },
        ],
        ..World::default()
    };

    let run_id = RunId::new("7");
    world.job_runs.insert(
        run_id.clone(),
        JobRun {
            id: run_id.clone(),
            job_id: job_id.clone(),
            origin: RunOrigin::Human,
            started_at: chrono::Local::now(),
            ended_at: None,
            parameters: "--size 1".to_owned(),
            status: RunStatus::Running,
            query_health: QueryHealth::Healthy,
            last_successful_query: chrono::Local::now(),
            report: ReportState::Available {
                format: ReportFormat::PlainText,
                text: "ok".into(),
            },
            error: None,
        },
    );
    world.index_job_run(run_id.clone());

    let bench_run = RunId::new("8");
    world.bench_runs.insert(
        bench_run.clone(),
        BenchRun {
            id: bench_run.clone(),
            bench_id: bench_id.clone(),
            by: Trigger::Agent,
            started_at: chrono::Local::now(),
            ended_at: None,
            parameters: "mesh=fine".to_owned(),
            plan: BenchPlan {
                steps: vec![BenchPlanStep {
                    index: 1,
                    job_id: job_id.clone(),
                    parameters: "--size 1".to_owned(),
                    run_id: run_id.clone(),
                }],
            },
            status: RunStatus::Running,
            query_health: QueryHealth::Healthy,
            last_successful_query: chrono::Local::now(),
            report: ReportState::Unavailable,
            error: None,
        },
    );
    world.index_bench_run(bench_run);

    let bridge = Bridge::new();
    bridge.publish(Snapshot::new(std::sync::Arc::new(world)));
    bridge
}

/// The tool explains itself: every route the interface answers is named in
/// what /help returns, so an agent can discover the surface from the surface.
#[test]
fn help_names_every_route() {
    let response = coco::agent::route(&get("/help"), &seeded_bridge());
    assert_eq!(response.status, 200);
    for path in [
        "/help",
        "/world",
        "/jobs",
        "/benches",
        "/jobs/{name}",
        "/benches/{name}",
        "/experiments/{name}/runs",
    ] {
        assert!(response.body.contains(path), "missing {path}");
    }
}

#[test]
fn jobs_are_listed_with_their_tallies() {
    let response = coco::agent::route(&get("/jobs"), &seeded_bridge());
    assert_eq!(response.status, 200, "{}", response.body);
    let jobs: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(jobs[0]["name"], "solver");
    assert_eq!(jobs[0]["folder"], "/tmp/lab/solver");
    assert_eq!(jobs[0]["runs"], 1);
    assert_eq!(jobs[0]["active"], 1);
    assert_eq!(jobs.as_array().unwrap().len(), 1, "the bench is not a job");
}

/// Detail answers carry file locations, not file contents (§43): the caller
/// is on this machine and reads the folder directly.
#[test]
fn a_job_detail_points_at_the_files() {
    let response = coco::agent::route(&get("/jobs/solver"), &seeded_bridge());
    assert_eq!(response.status, 200, "{}", response.body);
    let job: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    assert_eq!(job["parameters"][0], "size");
    let location = &job["runs"][0]["location"];
    assert_eq!(location["run_dir"], "/tmp/lab/solver/runs/7");
    assert_eq!(location["record"], "/tmp/lab/solver/runs/7/run.json");
    assert_eq!(location["report"], "/tmp/lab/solver/report/7.txt");
}

#[test]
fn a_bench_detail_names_its_calls_and_locations() {
    let response = coco::agent::route(&get("/benches/sweep"), &seeded_bridge());
    assert_eq!(response.status, 200, "{}", response.body);
    let bench: serde_json::Value = serde_json::from_str(&response.body).unwrap();
    let run = &bench["runs"][0];
    assert_eq!(run["calls"][0]["job"], "solver");
    assert_eq!(run["calls"][0]["run_id"], "7");
    assert_eq!(
        run["location"]["members"],
        "/tmp/lab/sweep/runs/8/members.json"
    );
    assert_eq!(
        run["location"]["report"],
        serde_json::Value::Null,
        "no report yet, so nothing to point at"
    );
}

/// A name that exists as the other kind deserves a pointer, not a flat no.
#[test]
fn the_wrong_kind_is_pointed_the_right_way() {
    let bridge = seeded_bridge();
    let response = coco::agent::route(&get("/jobs/sweep"), &bridge);
    assert_eq!(response.status, 404);
    assert!(
        response.body.contains("/benches/sweep"),
        "{}",
        response.body
    );
    let response = coco::agent::route(&get("/jobs/ghost"), &bridge);
    assert_eq!(response.status, 404);
    assert!(response.body.contains("No such job"), "{}", response.body);
}

/// The whole wire, end to end: what curl would write, what curl would read.
#[test]
fn the_socket_answers_http_a_curl_can_speak() {
    let path = socket_path("wire");
    let _server = Server::start(path.clone(), Bridge::new()).unwrap();

    let mut stream = UnixStream::connect(&path).unwrap();
    stream
        .write_all(b"GET /world HTTP/1.1\r\nHost: coco\r\nConnection: close\r\n\r\n")
        .unwrap();
    let mut reply = String::new();
    stream.read_to_string(&mut reply).unwrap();

    assert!(reply.starts_with("HTTP/1.1 200 OK\r\n"), "{reply}");
    assert!(reply.contains("Content-Type: application/json"), "{reply}");
    assert!(reply.contains("entities"), "{reply}");
}

/// The whole promise of §43, with nothing stood in for: a start over the
/// socket reaches the real worker on its real thread, runs the folder's own
/// launch script, and the world that follows shows the run with its origin.
#[test]
fn a_start_over_the_socket_runs_through_the_real_worker() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::TempDir::new().unwrap();
    let folder = dir.path().join("solver");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("job.tmpl"), "#!/bin/sh\necho {{ size }}\n").unwrap();
    for (name, body) in [
        ("launch.sh", "#!/bin/sh\necho 'COCO_RETURN: sub-77'\n"),
        ("poll.sh", "#!/bin/sh\necho 'COCO_RETURN: sub-77 RUNNING'\n"),
        ("report.sh", "#!/bin/sh\necho ok\n"),
        ("cancel.sh", "#!/bin/sh\necho ok\n"),
    ] {
        let script = folder.join(name);
        std::fs::write(&script, body).unwrap();
        let mut permissions = std::fs::metadata(&script).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script, permissions).unwrap();
    }
    std::fs::write(
        folder.join("coco.toml"),
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

    let mut adapter = coco::adapter::EngineAdapter::new(
        coco::engine::Coco::new(dir.path().join("store.json")).unwrap(),
    );
    use coco::adapter::Experiments as _;
    adapter.register_folder(&folder).unwrap();

    let path = socket_path("real-worker");
    let bridge = Bridge::new();
    let _server = Server::start(path.clone(), Arc::clone(&bridge)).unwrap();
    let _handle = coco::worker::Worker::spawn(Box::new(adapter), Some(bridge), None).unwrap();

    let mut stream = UnixStream::connect(&path).unwrap();
    let body = r#"{"parameters": {"size": "1"}}"#;
    stream
        .write_all(
            format!(
                "POST /experiments/solver/runs HTTP/1.1\r\nHost: coco\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .unwrap();
    let mut reply = String::new();
    stream.read_to_string(&mut reply).unwrap();
    assert!(reply.starts_with("HTTP/1.1 201 "), "{reply}");
    assert!(reply.contains("run_id"), "{reply}");

    // The world that follows shows the run, stamped with who asked for it.
    // The worker publishes right after answering; this allows it a moment.
    let mut world = String::new();
    for _ in 0..200 {
        let mut stream = UnixStream::connect(&path).unwrap();
        stream
            .write_all(b"GET /world HTTP/1.1\r\nHost: coco\r\nConnection: close\r\n\r\n")
            .unwrap();
        world.clear();
        stream.read_to_string(&mut world).unwrap();
        if world.contains("\"origin\":\"Agent\"") {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(world.contains("\"origin\":\"Agent\""), "{world}");
}

/// A body too large to be a mistake is refused on its declared length, before
/// a byte of it is read.
#[test]
fn an_oversized_body_is_refused_at_the_door() {
    let path = socket_path("oversized");
    let _server = Server::start(path.clone(), Bridge::new()).unwrap();

    let mut stream = UnixStream::connect(&path).unwrap();
    stream
        .write_all(
            b"POST /experiments/x/runs HTTP/1.1\r\nHost: coco\r\n\
              Content-Length: 10000000\r\nConnection: close\r\n\r\n",
        )
        .unwrap();
    let mut reply = String::new();
    stream.read_to_string(&mut reply).unwrap();

    assert!(reply.starts_with("HTTP/1.1 413 "), "{reply}");
}
