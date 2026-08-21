//! `coco-mcp-server` — the agent interface (§43) as an MCP server.
//!
//! An agent's MCP client launches this binary and speaks JSON-RPC to it over
//! stdio; every tool call becomes one HTTP request over coco's Unix socket
//! (§43.2). Nothing is decided here: this is a translator, and the socket's
//! answers pass through verbatim, so an agent reading a refusal sees the same
//! sentence a person would have been shown.
//!
//! The MCP subset needed — initialize, tools/list, tools/call, one line of
//! JSON per message — is written out rather than taken as a dependency. HTTP
//! is the opposite call: libcurl speaks it (the `curl` crate), because a
//! hand-rolled HTTP client is code its reviewer would have to audit line by
//! line, and libcurl has been audited by the world instead. No TLS and no
//! async runtime — a private socket needs neither.
//!
//! It is its own crate because it outlived the implementation it was written
//! in. It speaks only the socket protocol of §43.2, and both cocos serve that
//! protocol identically, so it drives the Electron workbench unchanged and
//! never learns which one is listening.

use std::collections::BTreeMap;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};

/// Where the socket lives — the same resolution coco's own server uses
/// (§43.2). Copied rather than imported: this crate must build without the
/// workbench it talks to.
fn socket_path() -> PathBuf {
    if let Ok(path) = std::env::var("COCO_SOCKET_PATH") {
        return PathBuf::from(path);
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".local/share/coco/coco.sock");
    }
    PathBuf::from("coco.sock")
}

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        // A notification carries no id and gets no reply (JSON-RPC 2.0).
        let Some(id) = message.get("id").cloned() else {
            continue;
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let params = message.get("params").cloned().unwrap_or(Value::Null);

        let reply = match dispatch(method, &params) {
            Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
            Err((code, text)) => json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": code, "message": text },
            }),
        };
        let mut out = stdout.lock();
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
}

fn dispatch(method: &str, params: &Value) -> Result<Value, (i64, String)> {
    match method {
        "initialize" => Ok(json!({
            // The newest revision this subset is known against; a client that
            // asked for an older one still gets a compatible shape.
            "protocolVersion": params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18"),
            "capabilities": { "tools": {} },
            "serverInfo": {
                "name": "coco",
                "title": "coco experiment workbench",
                "version": env!("CARGO_PKG_VERSION"),
            },
            "instructions": "coco runs experiments out of their own folders and tracks \
                             their runs. Call coco_help first: it explains the tool and \
                             every operation. Responses carry file locations rather than \
                             file contents — coco is local-only, so read those paths \
                             directly. coco must be running (its window open) for these \
                             tools to answer.",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            call_tool(name, &arguments)
        }
        _ => Err((-32601, format!("method not found: {method}"))),
    }
}

fn tools() -> Value {
    let no_arguments = json!({ "type": "object", "properties": {} });
    let by_name = json!({
        "type": "object",
        "properties": { "name": { "type": "string", "description": "The experiment's name (unique across the Explorer)." } },
        "required": ["name"],
    });
    json!([
        {
            "name": "coco_help",
            "description": "What coco is and everything this interface answers. Call this first.",
            "inputSchema": no_arguments,
        },
        {
            "name": "coco_list_jobs",
            "description": "Every Job: name, folder, declared parameters, run tallies.",
            "inputSchema": no_arguments,
        },
        {
            "name": "coco_list_benches",
            "description": "Every Bench (a fan-out launcher over existing Jobs), same shape.",
            "inputSchema": no_arguments,
        },
        {
            "name": "coco_job",
            "description": "One Job and its runs, oldest first. Each run carries file locations (run_dir, record, report) to read directly from disk.",
            "inputSchema": by_name,
        },
        {
            "name": "coco_bench",
            "description": "One Bench and its runs, each with the calls it dispatched and its file locations.",
            "inputSchema": by_name,
        },
        {
            "name": "coco_start",
            "description": "Start a Job or Bench by name. Every declared parameter must be supplied (coco_job lists them). Returns the run id; the run appears STARTING at once and advances as its scripts answer.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "experiment": { "type": "string", "description": "The experiment's name." },
                    "parameters": {
                        "type": "object",
                        "description": "One value per declared parameter, all strings.",
                        "additionalProperties": { "type": "string" },
                    },
                },
                "required": ["experiment"],
            },
        },
    ])
}

fn call_tool(name: &str, arguments: &Value) -> Result<Value, (i64, String)> {
    let outcome = match name {
        "coco_help" => http("GET", "/help", None),
        "coco_list_jobs" => http("GET", "/jobs", None),
        "coco_list_benches" => http("GET", "/benches", None),
        "coco_job" => http("GET", &format!("/jobs/{}", encoded_name(arguments)?), None),
        "coco_bench" => http(
            "GET",
            &format!("/benches/{}", encoded_name(arguments)?),
            None,
        ),
        "coco_start" => {
            let experiment = arguments
                .get("experiment")
                .and_then(Value::as_str)
                .ok_or((-32602, "coco_start needs `experiment`".to_owned()))?;
            let parameters: BTreeMap<String, Value> = arguments
                .get("parameters")
                .and_then(Value::as_object)
                .map(|object| object.clone().into_iter().collect())
                .unwrap_or_default();
            http(
                "POST",
                &format!("/experiments/{}/runs", percent_encode(experiment)),
                Some(json!({ "parameters": parameters }).to_string()),
            )
        }
        other => return Err((-32602, format!("no such tool: {other}"))),
    };

    // A refused request is a tool result, not a protocol error: the agent is
    // the one who can act on the sentence inside it.
    let (status, body) = outcome.map_err(|error| (-32603, error))?;
    Ok(json!({
        "content": [{ "type": "text", "text": body }],
        "isError": status >= 400,
    }))
}

fn encoded_name(arguments: &Value) -> Result<String, (i64, String)> {
    arguments
        .get("name")
        .and_then(Value::as_str)
        .map(percent_encode)
        .ok_or((-32602, "this tool needs `name`".to_owned()))
}

/// One request, one response — libcurl over the Unix socket (§43.2), the
/// same dialect `curl --unix-socket` speaks by hand.
fn http(method: &str, path: &str, body: Option<String>) -> Result<(u16, String), String> {
    let socket = socket_path();
    perform(&socket, method, path, body).map_err(|error| {
        if error.is_couldnt_connect() {
            format!(
                "coco is not answering on {} ({error}); the interface exists only while \
                 the coco window is running",
                socket.display()
            )
        } else {
            error.to_string()
        }
    })
}

fn perform(
    socket: &Path,
    method: &str,
    path: &str,
    body: Option<String>,
) -> Result<(u16, String), curl::Error> {
    let mut easy = curl::easy::Easy::new();
    easy.unix_socket(&socket.to_string_lossy())?;
    // The host is never resolved over a Unix socket; the URL just needs one.
    easy.url(&format!("http://coco{path}"))?;
    easy.connect_timeout(Duration::from_secs(5))?;
    // Outlives the server's own 30-second engine wait (§43.3), so a slow
    // answer is still an answer and only a hang times out.
    easy.timeout(Duration::from_secs(60))?;
    if let Some(body) = &body {
        debug_assert_eq!(method, "POST");
        easy.post(true)?;
        easy.post_fields_copy(body.as_bytes())?;
        let mut headers = curl::easy::List::new();
        headers.append("Content-Type: application/json")?;
        easy.http_headers(headers)?;
    }

    let mut reply = Vec::new();
    {
        let mut transfer = easy.transfer();
        transfer.write_function(|data| {
            reply.extend_from_slice(data);
            Ok(data.len())
        })?;
        transfer.perform()?;
    }
    let status = easy.response_code()? as u16;
    Ok((status, String::from_utf8_lossy(&reply).into_owned()))
}

/// Experiment names are folder names, and a folder name may hold a space.
fn percent_encode(name: &str) -> String {
    let mut encoded = String::with_capacity(name.len());
    for byte in name.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            other => encoded.push_str(&format!("%{other:02X}")),
        }
    }
    encoded
}
