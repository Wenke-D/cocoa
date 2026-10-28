//! The `cocoa-mcp-server` binary, driven as an agent's MCP client would drive it:
//! JSON-RPC lines over stdio, each tool call crossing a real Unix socket.
//!
//! The socket is answered by a stub in this file rather than by a real cocoa.
//! That is the boundary this crate owns: whether a tool call becomes the right
//! request, and whether the answer comes back as tool content. Whether cocoa
//! answers *correctly* is cocoa's own test, and the two implementations have
//! one each. Standing a real engine up here would tie the one artifact meant
//! to outlive them to whichever one is currently alive.

#![cfg(unix)]

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread::JoinHandle;

use serde_json::{Value, json};

fn socket_path() -> std::path::PathBuf {
    let path = std::path::PathBuf::from("/tmp/cocoa-test-mcp.sock");
    let _ = std::fs::remove_file(&path);
    path
}

/// Stops the stub when the test drops it, so a failed assertion does not leave
/// a listener and a stale socket file behind.
struct Stub {
    handle: Option<JoinHandle<()>>,
    path: std::path::PathBuf,
}

impl Drop for Stub {
    fn drop(&mut self) {
        // Unblock the accept loop, then let it finish.
        let _ = UnixStream::connect(&self.path);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Answers the routes this test exercises, and 404s the rest — the subset
/// of §43.2 the binary speaks: one request, one response, connection closed.
fn serve() -> Stub {
    serve_at(socket_path())
}

fn serve_at(path: std::path::PathBuf) -> Stub {
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).unwrap();
    let listening = path.clone();

    let handle = std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let Some((request, received)) = read_request(&mut stream) else {
                // The connection Drop makes to unblock accept sends nothing.
                break;
            };
            let (status, body) = match request.as_str() {
                "GET /jobs" => (200, json!([{ "name": "solver" }]).to_string()),
                "POST /experiments/solver/runs" => (201, json!({ "run_id": "9" }).to_string()),
                "POST /experiments/my%20solver/runs/9/cancel" => {
                    (202, json!({ "run_id": "9" }).to_string())
                }
                // Echoes what arrived, so the test sees the body cross intact.
                "POST /experiments" => (201, json!({ "received": received }).to_string()),
                _ => (404, json!({ "error": "no such route" }).to_string()),
            };
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 {status} \r\nContent-Type: application/json\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            );
            // The client reads to EOF, so the close is part of the reply.
            let _ = stream.shutdown(std::net::Shutdown::Write);
        }
        let _ = std::fs::remove_file(&listening);
    });

    Stub {
        handle: Some(handle),
        path,
    }
}

/// `METHOD path` and the body, read whole so the write side is not answering
/// into a half-read request.
fn read_request(stream: &mut UnixStream) -> Option<(String, String)> {
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut first = String::new();
    if reader.read_line(&mut first).ok()? == 0 {
        return None;
    }
    let mut parts = first.split_whitespace();
    let method = parts.next()?.to_owned();
    let path = parts.next()?.to_owned();

    let mut length = 0usize;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 {
            break;
        }
        if header == "\r\n" || header == "\n" {
            break;
        }
        if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
            length = value.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).ok()?;
    Some((
        format!("{method} {path}"),
        String::from_utf8_lossy(&body).into_owned(),
    ))
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
    Command::new(env!("CARGO_BIN_EXE_cocoa-mcp-server"))
        .env("COCOA_SOCKET_PATH", "/tmp/cocoa-test-mcp.sock")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap()
}

#[test]
fn the_mcp_binary_serves_the_socket_as_tools() {
    let _stub = serve();
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
    assert_eq!(reply["result"]["serverInfo"]["name"], "cocoa");
    assert!(
        reply["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains("cocoa_help"),
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
        "cocoa_help",
        "cocoa_launch",
        "cocoa_list_jobs",
        "cocoa_list_campaigns",
        "cocoa_job",
        "cocoa_campaign",
        "cocoa_start",
        "cocoa_register",
        "cocoa_cancel",
    ] {
        assert!(names.contains(&expected), "{names:?} misses {expected}");
    }

    // A read crosses the socket and comes back as tool content.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": { "name": "cocoa_list_jobs", "arguments": {} } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], false, "{reply}");
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    let jobs: Value = serde_json::from_str(text).unwrap();
    assert_eq!(
        jobs[0]["name"], "solver",
        "the socket's answer passes through verbatim"
    );

    // A start goes through the same door a click goes through.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": { "name": "cocoa_start",
                            "arguments": { "experiment": "solver",
                                           "parameters": { "size": "1" } } } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], false, "{reply}");
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("run_id"), "{text}");

    // A registration carries the folder's path, and nothing else, as JSON.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 5, "method": "tools/call",
                "params": { "name": "cocoa_register",
                            "arguments": { "path": "/abs/my solver" } } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], false, "{reply}");
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    let echoed: Value = serde_json::from_str(text).unwrap();
    let received: Value = serde_json::from_str(echoed["received"].as_str().unwrap()).unwrap();
    assert_eq!(received, json!({ "path": "/abs/my solver" }));

    // Without a path there is nothing to ask cocoa.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 6, "method": "tools/call",
                "params": { "name": "cocoa_register", "arguments": {} } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["error"]["code"], -32602, "{reply}");

    // A cancel is a POST to the run, its name escaped like any other.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
                "params": { "name": "cocoa_cancel",
                            "arguments": { "experiment": "my solver", "run_id": "9" } } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], false, "{reply}");

    // Without the run there is nothing to cancel.
    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 8, "method": "tools/call",
                "params": { "name": "cocoa_cancel",
                            "arguments": { "experiment": "my solver" } } }),
    );
    let reply = read_reply(&mut lines);
    assert_eq!(reply["error"]["code"], -32602, "{reply}");

    drop(stdin);
    let _ = child.wait();
}

/// cocoa not running is the caller's most likely mistake, so the answer must
/// say so rather than read as a broken tool.
#[test]
fn a_tool_call_without_a_running_cocoa_says_so() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_cocoa-mcp-server"))
        .env("COCOA_SOCKET_PATH", "/tmp/cocoa-test-mcp-absent.sock")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

    send(
        &mut stdin,
        json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
                "params": { "name": "cocoa_list_jobs", "arguments": {} } }),
    );
    let reply = read_reply(&mut lines);
    let message = reply["error"]["message"].as_str().unwrap();
    assert!(message.contains("cocoa is not answering"), "{message}");
    assert!(message.contains("window is running"), "{message}");
    assert!(
        message.contains("cocoa_launch"),
        "the answer names the way out: {message}"
    );

    drop(stdin);
    let _ = child.wait();
}

/// A scratch home of its own under `/tmp` — a socket path must stay short —
/// with the directory every profile's socket is in.
fn scratch_home(name: &str) -> std::path::PathBuf {
    let home = std::path::PathBuf::from(format!("/tmp/cocoa-mcp-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".local/share/cocoa")).unwrap();
    home
}

/// A stand-in for the app: it records how it was started, which is the
/// moment the test brings the socket up in its place.
fn fake_app(home: &std::path::Path) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let app = home.join("fake-cocoa");
    std::fs::write(
        &app,
        "#!/bin/sh\necho \"$* ${ELECTRON_RUN_AS_NODE:-unset}\" > \"$0.ran\"\n",
    )
    .unwrap();
    std::fs::set_permissions(&app, std::fs::Permissions::from_mode(0o755)).unwrap();
    app
}

fn call(stdin: &mut ChildStdin, id: u64, name: &str) {
    send(
        stdin,
        json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call",
                "params": { "name": name, "arguments": {} } }),
    );
}

/// cocoa not running is no longer a dead end: the agent may open it, as the
/// user would — the installed app, for the profile the socket belongs to —
/// and the tool answers once cocoa does.
#[test]
fn cocoa_launch_opens_a_silent_cocoa_and_waits_for_it() {
    let home = scratch_home("launch");
    let socket = home.join(".local/share/cocoa/cocoa-dev.sock");
    let app = fake_app(&home);
    let ran = home.join("fake-cocoa.ran");
    let mut child = Command::new(env!("CARGO_BIN_EXE_cocoa-mcp-server"))
        .env("HOME", &home)
        .env("COCOA_SOCKET_PATH", &socket)
        .env("COCOA_APP", &app)
        .env("ELECTRON_RUN_AS_NODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

    call(&mut stdin, 1, "cocoa_launch");
    // The app has started when it has written down how; cocoa answers soon after.
    let started = std::time::Instant::now();
    while !ran.exists() {
        assert!(
            started.elapsed() < std::time::Duration::from_secs(10),
            "the app was never started"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let stub = serve_at(socket.clone());

    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], false, "{reply}");
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.starts_with("Started cocoa"), "{text}");
    assert_eq!(
        std::fs::read_to_string(&ran).unwrap().trim(),
        "--profile dev unset",
        "the profile is the socket's, and Electron is not told to be Node"
    );

    // A cocoa that answers is left alone.
    std::fs::remove_file(&ran).unwrap();
    call(&mut stdin, 2, "cocoa_launch");
    let reply = read_reply(&mut lines);
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("already running"), "{text}");
    assert!(!ran.exists(), "a running cocoa was launched again");

    drop(stdin);
    let _ = child.wait();
    drop(stub);
    let _ = std::fs::remove_dir_all(&home);
}

/// An app that cannot be started is the agent's to report, with the way to
/// point the tool at the right one.
#[test]
fn cocoa_launch_says_so_when_cocoa_cannot_start() {
    let home = scratch_home("no-app");
    let mut child = Command::new(env!("CARGO_BIN_EXE_cocoa-mcp-server"))
        .env("HOME", &home)
        .env_remove("COCOA_SOCKET_PATH")
        .env("COCOA_APP", home.join("no-such-cocoa"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();

    call(&mut stdin, 1, "cocoa_launch");
    let reply = read_reply(&mut lines);
    assert_eq!(reply["result"]["isError"], true, "{reply}");
    let text = reply["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("could not start cocoa"), "{text}");
    assert!(text.contains("COCOA_APP"), "{text}");

    drop(stdin);
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&home);
}
