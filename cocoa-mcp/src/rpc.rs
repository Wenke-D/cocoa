//! The MCP subset this server speaks: JSON-RPC 2.0 over stdio.

use std::io::{BufRead, Write};

use serde_json::{Value, json};

use crate::manual::MANUAL_RAW;
use crate::tools::{call_tool, tools};

/// Answers JSON-RPC over stdio, one message per line, until stdin closes.
pub(crate) fn serve() {
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

pub(crate) fn dispatch(method: &str, params: &Value) -> Result<Value, (i64, String)> {
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
                "name": "cocoa",
                "title": "cocoa experiment workbench",
                "version": env!("CARGO_PKG_VERSION"),
            },
            "instructions": format!(
                "cocoa runs experiments out of their own folders and tracks their runs. \
                 Before working on the user's experiments, read the manual for agents, \
                 {MANUAL_RAW}: the rules you work by, and how an experiment's scripts and \
                 reports are written. Call cocoa_help first: it explains the tool and \
                 every operation. Responses carry file locations rather than file \
                 contents — cocoa is local-only, so read those paths directly. cocoa must \
                 be running (its window open) for these tools to answer; when it is not, \
                 cocoa_launch opens it."
            ),
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
