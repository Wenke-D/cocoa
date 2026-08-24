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

/// Answers the two routes this test exercises, and 404s the rest — the subset
/// of §43.2 the binary speaks: one request, one response, connection closed.
fn serve() -> Stub {
    let path = socket_path();
    let listener = UnixListener::bind(&path).unwrap();
    let listening = path.clone();

    let handle = std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let Some(request) = read_request_line(&mut stream) else {
                // The connection Drop makes to unblock accept sends nothing.
                break;
            };
            let (status, body) = match request.as_str() {
                "GET /jobs" => (200, json!([{ "name": "solver" }]).to_string()),
                "POST /experiments/solver/runs" => (201, json!({ "run_id": "9" }).to_string()),
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

/// `METHOD path`, with the headers and any body drained so the write side is
/// not answering into a half-read request.
fn read_request_line(stream: &mut UnixStream) -> Option<String> {
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
    if length > 0 {
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body).ok()?;
    }
    Some(format!("{method} {path}"))
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
        "cocoa_list_jobs",
        "cocoa_list_benches",
        "cocoa_job",
        "cocoa_bench",
        "cocoa_start",
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

    drop(stdin);
    let _ = child.wait();
}
