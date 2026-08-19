//! The `coco-mcp-server` binary, driven as an agent's MCP client would drive it:
//! JSON-RPC lines over stdio, each tool call crossing the real socket.

#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use coco::agent::{Bridge, Reply, Server};
use serde_json::{Value, json};

fn socket_path() -> std::path::PathBuf {
    let path = std::path::PathBuf::from("/tmp/coco-test-mcp.sock");
    let _ = std::fs::remove_file(&path);
    path
}

/// One Job in the world, and a stand-in worker that answers starts.
fn serve() -> (Arc<Bridge>, Server) {
    use coco::view_model::{Entity, EntityId, EntityKind, ManifestState, Snapshot, World};

    let world = World {
        entities: vec![Entity {
            id: EntityId::new("/tmp/lab/solver"),
            kind: EntityKind::Job,
            name: "solver".to_owned(),
            path: "~/lab/solver".to_owned(),
            manifest: ManifestState::Valid,
            parameter_names: vec!["size".to_owned()],
            last_used: Default::default(),
        }],
        ..World::default()
    };
    let bridge = Bridge::new();
    bridge.publish(Snapshot::new(Arc::new(world)));

    let drain = Arc::clone(&bridge);
    std::thread::spawn(move || {
        for _ in 0..600 {
            for pending in drain.take_pending() {
                let _ = pending.reply.send(Ok(Reply::Started {
                    run_id: "9".to_owned(),
                }));
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    });

    let server = Server::start(socket_path(), Arc::clone(&bridge)).unwrap();
    (bridge, server)
}

fn send(stdin: &mut ChildStdin, message: Value) {
    writeln!(stdin, "{message}").unwrap();
    stdin.flush().unwrap();
}

fn read_reply(lines: &mut impl Iterator<Item = std::io::Result<String>>) -> Value {
    let line = lines.next().expect("a reply line").unwrap();
    serde_json::from_str(&line).unwrap()
}

fn spawn_mcp() -> Child {
    Command::new(env!("CARGO_BIN_EXE_coco-mcp-server"))
        .env("COCO_SOCKET_PATH", "/tmp/coco-test-mcp.sock")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap()
}

#[test]
fn the_mcp_binary_serves_the_socket_as_tools() {
    let (_bridge, _server) = serve();
    let mut child = spawn_mcp();
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

    // The handshake an MCP client opens with.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": { "protocolVersion": "2025-06-18",
                            "clientInfo": { "name": "test", "version": "0" },
                            "capabilities": {} } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["serverInfo"]["name"], "coco");
    assert!(
        reply["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains("coco_help"),
        "the instructions point at the help tool"
    );

    // A notification gets no reply; the next line answers the next request.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
    );
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }),
    );
    let reply = read_reply(&mut lines);
    let names: Vec<&str> = reply["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect();
    for expected in [
        "coco_help",
        "coco_list_jobs",
        "coco_list_benches",
        "coco_job",
        "coco_bench",
        "coco_start",
        "coco_overview",
    ] {
        assert!(names.contains(&expected), "{names:?} misses {expected}");
    }

    // A read crosses the socket and comes back as tool content.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "coco_list_jobs", "arguments": {} } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], false, "{reply}");
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    let jobs: Value = serde_json::from_str(text).unwrap();
    assert_eq!(jobs[0]["name"], "solver");

    // A start goes through the same door a click goes through.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": { "name": "coco_start",
                            "arguments": { "experiment": "solver",
                                           "parameters": { "size": "1" } } } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], false, "{reply}");
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("run_id"), "{text}");

    drop(stdin);
    let _ = child.wait();
}

/// coco not running is the caller's most likely mistake, so the answer must
/// say so rather than read as a broken tool.
#[test]
fn a_tool_call_without_a_running_coco_says_so() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_coco-mcp-server"))
        .env("COCO_SOCKET_PATH", "/tmp/coco-test-mcp-absent.sock")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": { "name": "coco_list_jobs", "arguments": {} } }),
    );
    let reply = read_reply(&mut lines);
    let message = reply["error"]["message"].as_str().unwrap();
    assert!(message.contains("coco is not answering"), "{message}");
    assert!(message.contains("window is running"), "{message}");

    drop(stdin);
    let _ = child.wait();
}
