//! The tools an agent is offered, and each one's request over the socket.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::percent_encode::percent_encode;
use crate::socket_client::http;

pub(crate) fn tools() -> Value {
    let no_arguments = json!({ "type": "object", "properties": {} });
    let by_name = json!({
        "type": "object",
        "properties": { "name": { "type": "string", "description": "The experiment's name (unique across the Explorer)." } },
        "required": ["name"],
    });
    json!([
        {
            "name": "cocoa_help",
            "description": "What cocoa is and everything this interface answers. Call this first.",
            "inputSchema": no_arguments,
        },
        {
            "name": "cocoa_list_jobs",
            "description": "Every Job: name, folder, declared parameters, run tallies.",
            "inputSchema": no_arguments,
        },
        {
            "name": "cocoa_list_campaigns",
            "description": "Every Campaign (a fan-out launcher over existing Jobs), same shape.",
            "inputSchema": no_arguments,
        },
        {
            "name": "cocoa_job",
            "description": "One Job and its runs, oldest first. Each run carries file locations (run_dir, record, report, attachments) to read directly from disk.",
            "inputSchema": by_name,
        },
        {
            "name": "cocoa_campaign",
            "description": "One Campaign and its runs, each with the calls it dispatched and its file locations.",
            "inputSchema": by_name,
        },
        {
            "name": "cocoa_start",
            "description": "Start a Job or Campaign by name. Every declared parameter must be supplied, shaped as declared (cocoa_job lists them with type, values and description). Every start runs the Job's check first: the run appears STARTING at once, or DEPLOYING while a stale Job is deployed first; a check that answers CONFLICT refuses the start with its reason and records nothing. Returns the run id; the run advances as its scripts answer.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "experiment": { "type": "string", "description": "The experiment's name." },
                    "parameters": {
                        "type": "object",
                        "description": "One value per declared parameter: a string for `string` and `enum` (one of its `values`), a non-empty array of strings for a `list` of either. Nothing is coerced; a yes/no parameter is an enum whose value is the word.",
                        "additionalProperties": {
                            "oneOf": [
                                { "type": "string" },
                                { "type": "array", "items": { "type": "string" }, "minItems": 1 }
                            ]
                        },
                    },
                },
                "required": ["experiment"],
            },
        },
        {
            "name": "cocoa_register",
            "description": "Register an experiment folder, as the Explorer's + does: its cocoa.toml decides whether it is a Job or a Campaign. Returns its name, kind and the tool to follow it with; a folder already registered is a no-op that says so. Refused, with the reason, for a path that is not absolute or not a folder, a manifest that does not load, or a name already taken.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "The folder's absolute path, the one holding its cocoa.toml." },
                },
                "required": ["path"],
            },
        },
        {
            "name": "cocoa_cancel",
            "description": "Cancel a Job or Campaign run through the Job's own cancel script, as the window's Cancel does but with no confirmation — cancel only a run the user asked you to stop, or one you started yourself. A Campaign run cancels each of its still-active member runs; finished members keep their results. A member run cancelled under its own Job leaves its Campaign run and siblings running. Accepted means the run reads Cancelling: follow it with cocoa_job or cocoa_campaign until a poll confirms Cancelled. Refused, with the reason, for a run that has ended, is still deploying or launching, is already Cancelling, or whose cancel script failed (the run keeps its status).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "experiment": { "type": "string", "description": "The Job's or Campaign's name." },
                    "run_id": { "type": "string", "description": "The run's id, as cocoa_job or cocoa_campaign lists it (ids are per experiment)." },
                },
                "required": ["experiment", "run_id"],
            },
        },
        {
            "name": "cocoa_lock_report",
            "description": "Lock or unlock a Job run's or a Campaign run's report, as the report row's Lock button does. A locked report is the user's to keep: it is not regenerated, and its run is not deleted (nor, for a Campaign member, its Campaign run) until it is unlocked. Lock or unlock one only when the user asks. Returns the state the report is now in; asking for the state it is already in changes nothing. Refused, with the reason, for a run with no report to lock, or one whose report is being generated.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "experiment": { "type": "string", "description": "The Job's or Campaign's name." },
                    "run_id": { "type": "string", "description": "The run's id, as cocoa_job or cocoa_campaign lists it (ids are per experiment)." },
                    "locked": { "type": "boolean", "description": "true to lock the report, false to unlock it." },
                },
                "required": ["experiment", "run_id", "locked"],
            },
        },
    ])
}

pub(crate) fn call_tool(name: &str, arguments: &Value) -> Result<Value, (i64, String)> {
    let outcome = match name {
        "cocoa_help" => http("GET", "/help", None),
        "cocoa_list_jobs" => http("GET", "/jobs", None),
        "cocoa_list_campaigns" => http("GET", "/campaigns", None),
        "cocoa_job" => http("GET", &format!("/jobs/{}", encoded_name(arguments)?), None),
        "cocoa_campaign" => http(
            "GET",
            &format!("/campaigns/{}", encoded_name(arguments)?),
            None,
        ),
        "cocoa_start" => {
            let experiment = arguments
                .get("experiment")
                .and_then(Value::as_str)
                .ok_or((-32602, "cocoa_start needs `experiment`".to_owned()))?;
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
        "cocoa_register" => {
            let path = arguments
                .get("path")
                .and_then(Value::as_str)
                .ok_or((-32602, "cocoa_register needs `path`".to_owned()))?;
            http(
                "POST",
                "/experiments",
                Some(json!({ "path": path }).to_string()),
            )
        }
        "cocoa_cancel" => {
            let experiment = arguments
                .get("experiment")
                .and_then(Value::as_str)
                .ok_or((-32602, "cocoa_cancel needs `experiment`".to_owned()))?;
            let run_id = arguments
                .get("run_id")
                .and_then(Value::as_str)
                .ok_or((-32602, "cocoa_cancel needs `run_id`".to_owned()))?;
            http(
                "POST",
                &format!(
                    "/experiments/{}/runs/{}/cancel",
                    percent_encode(experiment),
                    percent_encode(run_id)
                ),
                // Empty, but there: a body is what makes the request a POST.
                Some(String::new()),
            )
        }
        "cocoa_lock_report" => {
            let experiment = arguments
                .get("experiment")
                .and_then(Value::as_str)
                .ok_or((-32602, "cocoa_lock_report needs `experiment`".to_owned()))?;
            let run_id = arguments
                .get("run_id")
                .and_then(Value::as_str)
                .ok_or((-32602, "cocoa_lock_report needs `run_id`".to_owned()))?;
            let locked = arguments.get("locked").and_then(Value::as_bool).ok_or((
                -32602,
                "cocoa_lock_report needs `locked`, true or false".to_owned(),
            ))?;
            http(
                "POST",
                &format!(
                    "/experiments/{}/runs/{}/report/lock",
                    percent_encode(experiment),
                    percent_encode(run_id)
                ),
                Some(json!({ "locked": locked }).to_string()),
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
