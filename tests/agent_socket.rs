//! The agent interface, exercised without a window (specification §37).
//!
//! The parts worth pinning down are the ones a running coco would make hard to
//! reach: what happens to a socket file the last window left behind, what a
//! second coco does when the first still owns it, and what each route answers.
//! The frame loop is stood in for by a thread that drains the bridge, which is
//! exactly what `ExperimentApp` does once a frame.

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

/// Stands in for the frame loop: drains what the socket queued, answers it.
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
