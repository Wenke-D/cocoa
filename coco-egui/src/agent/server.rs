//! The listener, and the routes it answers.

use std::collections::BTreeMap;
use std::io;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;

use super::http::{self, Request as HttpRequest, Response};
use super::{Bridge, Reply, Request};
use crate::view_model::{Entity, EntityKind, ReportState, RunId, Snapshot};

/// How long a caller waits for the frame loop before being told coco is not
/// answering. Generous: a frame is milliseconds, and a start runs the
/// experiment's own launch script, which talks to a cluster.
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);

pub use super::default_socket_path as socket_path;

/// The socket, for as long as coco is running.
///
/// Dropping it removes the socket file, so the next launch does not have to
/// reason about whether the file it found belongs to a live window.
pub struct Server {
    /// `tiny_http` speaks the wire; who may bind, and when the file goes away,
    /// stays coco's decision.
    inner: Arc<tiny_http::Server>,
    path: PathBuf,
}

impl std::fmt::Debug for Server {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Server").field("path", &self.path).finish()
    }
}

impl Server {
    /// Binds the socket and serves it on background threads.
    ///
    /// A socket file left by a crash is replaced. One left by a *running* coco
    /// is not: that window owns the store, and two owners is the situation this
    /// whole design exists to avoid, so this returns an error and the second
    /// window runs without an interface rather than stealing the first's.
    pub fn start(path: PathBuf, bridge: Arc<Bridge>) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        if path.exists() {
            if UnixStream::connect(&path).is_ok() {
                return Err(io::Error::new(
                    io::ErrorKind::AddrInUse,
                    format!("another coco is already answering on {}", path.display()),
                ));
            }
            // Nothing is listening: the file outlived the window that made it.
            std::fs::remove_file(&path)?;
        }

        let inner = tiny_http::Server::http_unix(&path).map_err(|error| {
            // "path must be shorter than SUN_LEN" tells you nothing about which
            // path or what the limit is. Socket paths are bounded well below
            // what a filesystem allows, and a deep `COCO_SOCKET_PATH` is the
            // way to trip it.
            io::Error::other(format!("cannot bind {}: {error}", path.display()))
        })?;
        let inner = Arc::new(inner);
        log::info!("agent interface listening on {}", path.display());

        let listener = Arc::clone(&inner);
        std::thread::Builder::new()
            .name("coco-agent".to_owned())
            .spawn(move || {
                loop {
                    match listener.recv() {
                        Ok(request) => {
                            let bridge = Arc::clone(&bridge);
                            // One short-lived thread per request: a start waits
                            // on the frame loop, and one slow caller must not
                            // hold the door shut for the next.
                            let spawned = std::thread::Builder::new()
                                .name("coco-agent-request".to_owned())
                                .spawn(move || serve(request, &bridge));
                            if let Err(error) = spawned {
                                log::warn!("agent request thread: {error}");
                            }
                        }
                        Err(error) => {
                            log::info!("agent socket closed: {error}");
                            break;
                        }
                    }
                }
            })?;

        Ok(Self { inner, path })
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.inner.unblock();
        let _ = std::fs::remove_file(&self.path);
    }
}

fn serve(mut request: tiny_http::Request, bridge: &Bridge) {
    let response = match http::receive(&mut request) {
        Ok(parsed) => route(&parsed, bridge),
        Err(response) => response,
    };
    if let Err(error) = request.respond(http::send(response)) {
        log::warn!("agent reply: {error}");
    }
}

#[derive(Deserialize)]
struct StartBody {
    #[serde(default)]
    parameters: BTreeMap<String, String>,
}

/// The routes. Kept in one place so the whole surface is readable at once.
pub fn route(request: &HttpRequest, bridge: &Bridge) -> Response {
    match (request.method.as_str(), request.segments().as_slice()) {
        // The tool explains itself, so an agent can discover the interface
        // from the interface.
        ("GET", ["help"]) => help(),

        // Everything the workbench renders from, as the workbench last saw it.
        // The same JSON `--dump-state` prints, and for the same reason: a
        // symptom becomes a fact you can grep.
        ("GET", ["world"]) => match serde_json::to_string(&*bridge.snapshot()) {
            Ok(json) => Response::json(200, json),
            Err(error) => Response::error(500, error),
        },

        ("GET", ["jobs"]) => list_entities(&bridge.snapshot(), EntityKind::Job),
        ("GET", ["benches"]) => list_entities(&bridge.snapshot(), EntityKind::Bench),
        ("GET", ["jobs", name]) => job_detail(&bridge.snapshot(), name),
        ("GET", ["benches", name]) => bench_detail(&bridge.snapshot(), name),

        ("POST", ["experiments", name, "runs"]) => {
            let parameters = if request.body.is_empty() {
                BTreeMap::new()
            } else {
                match serde_json::from_slice::<StartBody>(&request.body) {
                    Ok(body) => body.parameters,
                    Err(error) => return Response::error(400, error),
                }
            };

            match bridge.submit(
                Request::Start {
                    experiment: (*name).to_owned(),
                    parameters,
                },
                REPLY_TIMEOUT,
            ) {
                Ok(Reply::Started { run_id }) => {
                    Response::json(201, serde_json::json!({ "run_id": run_id }).to_string())
                }
                // The workbench's own failure text, unchanged: an agent reading
                // it should see what a person would have been shown.
                Err(message) => Response::error(status_for(&message), message),
            }
        }

        ("GET", _) | ("POST", _) => Response::error(404, "no such endpoint"),
        _ => Response::error(405, "unsupported method"),
    }
}

/// Which failure this was, as far as the wire is concerned.
///
/// The engine's errors are sentences meant for a person, so this reads them
/// rather than inventing a parallel set of codes. Anything unrecognised is a
/// `400`: the request was refused, and the caller is the one who can act.
fn status_for(message: &str) -> u16 {
    if message.starts_with("No such entity") {
        404
    } else if message.contains("did not answer in time") {
        503
    } else {
        400
    }
}

/// What this socket is and everything it answers, served from the socket
/// itself. Lives next to [`route`] so the description and the routes cannot
/// drift apart unnoticed.
fn help() -> Response {
    Response::json(
        200,
        serde_json::json!({
            "what": "coco is a local workbench for experiment folders. An experiment is a \
                     folder with a manifest and its own scripts (launch, poll, report, \
                     cancel); coco starts runs through those scripts, tracks each run's \
                     status, and collects reports. This socket is the agent interface — \
                     the same engine the window drives, reached over HTTP/1.1 on a Unix \
                     socket.",
            "how_to_reach_it": "curl --unix-socket ~/.local/share/coco/coco.sock \
                                http://localhost/<path> (COCO_SOCKET_PATH overrides the \
                                location), or the bundled `coco-mcp-server` binary, which serves \
                                these routes as MCP tools.",
            "local_by_design": "Every caller is on this machine, so detail responses \
                                carry file *locations* — the experiment folder, a run's \
                                directory and record, a report file — rather than file \
                                contents. Read them straight from disk.",
            "endpoints": [
                { "method": "GET", "path": "/help",
                  "answers": "this document" },
                { "method": "GET", "path": "/world",
                  "answers": "the whole snapshot the window renders from — the same JSON \
                              `coco --dump-state` prints" },
                { "method": "GET", "path": "/jobs",
                  "answers": "every Job: name, folder, declared parameters, run tallies" },
                { "method": "GET", "path": "/benches",
                  "answers": "every Bench, in the same shape" },
                { "method": "GET", "path": "/jobs/{name}",
                  "answers": "one Job and its runs, oldest first, each run with the \
                              locations to read directly (run_dir, record, report)" },
                { "method": "GET", "path": "/benches/{name}",
                  "answers": "one Bench and its runs, each with the calls it dispatched \
                              and its locations (run_dir, record, members, report)" },
                { "method": "POST", "path": "/experiments/{name}/runs",
                  "body": { "parameters": { "<declared name>": "<value>" } },
                  "answers": "starts the Job or Bench; 201 with {run_id}. Every declared \
                              parameter must be supplied — GET /jobs/{name} lists them. \
                              The run appears STARTING at once; its submission id and \
                              status advance in /world as the scripts answer." },
            ],
        })
        .to_string(),
    )
}

fn list_entities(snapshot: &Snapshot, kind: EntityKind) -> Response {
    let items: Vec<serde_json::Value> = snapshot
        .entities
        .iter()
        .filter(|entity| entity.kind == kind)
        .map(|entity| {
            let run_ids = run_ids_of(snapshot, entity);
            let active = run_ids
                .iter()
                .filter(|id| match kind {
                    EntityKind::Job => snapshot
                        .job_runs
                        .get(id)
                        .is_some_and(|run| run.status.is_active()),
                    EntityKind::Bench => snapshot
                        .bench_runs
                        .get(id)
                        .is_some_and(|run| run.status.is_active()),
                })
                .count();
            serde_json::json!({
                "name": entity.name,
                "folder": entity.id.as_str(),
                "manifest": entity.manifest,
                "parameters": entity.parameter_names,
                "runs": run_ids.len(),
                "active": active,
            })
        })
        .collect();
    Response::json(200, serde_json::json!(items).to_string())
}

fn job_detail(snapshot: &Snapshot, name: &str) -> Response {
    let Some(entity) = find_entity(snapshot, name, EntityKind::Job) else {
        return no_such_entity(snapshot, name, EntityKind::Job);
    };
    let folder = std::path::Path::new(entity.id.as_str());

    let runs: Vec<serde_json::Value> = run_ids_of(snapshot, entity)
        .iter()
        .filter_map(|id| snapshot.job_runs.get(id))
        .map(|run| {
            let run_dir = folder.join("runs").join(run.id.to_string());
            serde_json::json!({
                "id": run.id,
                "status": run.status,
                "origin": run.origin,
                "started_at": run.started_at,
                "ended_at": run.ended_at,
                "parameters": run.parameters,
                "query_health": run.query_health,
                "error": run.error,
                "location": {
                    "run_dir": run_dir,
                    "record": run_dir.join("run.json"),
                    "report": report_location(folder, &run.id, &run.report),
                },
            })
        })
        .collect();

    Response::json(
        200,
        serde_json::json!({
            "name": entity.name,
            "kind": "job",
            "folder": entity.id.as_str(),
            "manifest": entity.manifest,
            "parameters": entity.parameter_names,
            "last_used": entity.last_used,
            "runs": runs,
        })
        .to_string(),
    )
}

fn bench_detail(snapshot: &Snapshot, name: &str) -> Response {
    let Some(entity) = find_entity(snapshot, name, EntityKind::Bench) else {
        return no_such_entity(snapshot, name, EntityKind::Bench);
    };
    let folder = std::path::Path::new(entity.id.as_str());

    let runs: Vec<serde_json::Value> = run_ids_of(snapshot, entity)
        .iter()
        .filter_map(|id| snapshot.bench_runs.get(id))
        .map(|run| {
            let run_dir = folder.join("runs").join(run.id.to_string());
            let calls: Vec<serde_json::Value> = run
                .plan
                .steps
                .iter()
                .map(|step| {
                    serde_json::json!({
                        "call": step.index,
                        "job": snapshot.entity_name(&step.job_id),
                        "parameters": step.parameters,
                        // Follow it under /jobs/{job}: the member is an
                        // ordinary Job run.
                        "run_id": step.run_id,
                    })
                })
                .collect();
            serde_json::json!({
                "id": run.id,
                "status": run.status,
                "by": run.by,
                "started_at": run.started_at,
                "ended_at": run.ended_at,
                "parameters": run.parameters,
                "query_health": run.query_health,
                "error": run.error,
                "calls": calls,
                "location": {
                    "run_dir": run_dir,
                    "record": run_dir.join("run.json"),
                    "members": run_dir.join("members.json"),
                    "report": report_location(folder, &run.id, &run.report),
                },
            })
        })
        .collect();

    Response::json(
        200,
        serde_json::json!({
            "name": entity.name,
            "kind": "bench",
            "folder": entity.id.as_str(),
            "manifest": entity.manifest,
            "parameters": entity.parameter_names,
            "last_used": entity.last_used,
            "runs": runs,
        })
        .to_string(),
    )
}

fn find_entity<'a>(snapshot: &'a Snapshot, name: &str, kind: EntityKind) -> Option<&'a Entity> {
    snapshot
        .entities
        .iter()
        .find(|entity| entity.name == name && entity.kind == kind)
}

/// The run ids of one entity, oldest first, from the index the pages read.
fn run_ids_of<'a>(snapshot: &'a Snapshot, entity: &Entity) -> &'a [RunId] {
    let index = match entity.kind {
        EntityKind::Job => &snapshot.runs_by_job,
        EntityKind::Bench => &snapshot.runs_by_bench,
    };
    index.get(&entity.id).map(Vec::as_slice).unwrap_or_default()
}

/// A name that exists as the other kind deserves a pointer, not a flat no.
fn no_such_entity(snapshot: &Snapshot, name: &str, asked: EntityKind) -> Response {
    let (this, other) = match asked {
        EntityKind::Job => ("job", "benches"),
        EntityKind::Bench => ("bench", "jobs"),
    };
    if snapshot.entities.iter().any(|entity| entity.name == name) {
        return Response::error(404, format!("{name} is not a {this}; ask /{other}/{name}"));
    }
    Response::error(404, format!("No such {this}: {name}"))
}

/// Where the report file is, when there is one to read.
fn report_location(
    folder: &std::path::Path,
    run_id: &RunId,
    report: &ReportState,
) -> Option<std::path::PathBuf> {
    match report {
        ReportState::Available { format, .. } => Some(
            folder
                .join("report")
                .join(format!("{run_id}.{}", format.file_extension())),
        ),
        _ => None,
    }
}
