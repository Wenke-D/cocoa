//! The listener, and the routes it answers.

use std::collections::BTreeMap;
use std::io;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;

use super::http::{Request as HttpRequest, Response, read_request};
use super::{Bridge, Reply, Request};

/// How long a caller waits for the frame loop before being told coco is not
/// answering. Generous: a frame is milliseconds, and a start runs the
/// experiment's own launch script, which talks to a cluster.
const REPLY_TIMEOUT: Duration = Duration::from_secs(30);

pub use super::default_socket_path as socket_path;

/// The socket, for as long as coco is running.
///
/// Dropping it removes the socket file, so the next launch does not have to
/// reason about whether the file it found belongs to a live window.
#[derive(Debug)]
pub struct Server {
    path: PathBuf,
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

        let listener = UnixListener::bind(&path).map_err(|error| {
            // "path must be shorter than SUN_LEN" tells you nothing about which
            // path or what the limit is. Socket paths are bounded well below
            // what a filesystem allows, and a deep `COCO_SOCKET_PATH` is the
            // way to trip it.
            io::Error::new(
                error.kind(),
                format!("cannot bind {}: {error}", path.display()),
            )
        })?;
        log::info!("agent interface listening on {}", path.display());

        std::thread::Builder::new()
            .name("coco-agent".to_owned())
            .spawn(move || {
                for stream in listener.incoming() {
                    match stream {
                        Ok(mut stream) => {
                            let bridge = Arc::clone(&bridge);
                            // One short-lived thread per request: a start waits
                            // on the frame loop, and one slow caller must not
                            // hold the door shut for the next.
                            let spawned = std::thread::Builder::new()
                                .name("coco-agent-request".to_owned())
                                .spawn(move || serve(&mut stream, &bridge));
                            if let Err(error) = spawned {
                                log::warn!("agent request thread: {error}");
                            }
                        }
                        Err(error) => {
                            log::warn!("agent socket closed: {error}");
                            break;
                        }
                    }
                }
            })?;

        Ok(Self { path })
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn serve(stream: &mut UnixStream, bridge: &Bridge) {
    let response = match read_request(stream) {
        Ok(request) => route(&request, bridge),
        Err(response) => response,
    };
    if let Err(error) = response.write(stream) {
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
        // Everything the workbench renders from, as the workbench last saw it.
        // The same JSON `--dump-state` prints, and for the same reason: a
        // symptom becomes a fact you can grep.
        ("GET", ["world"]) => match serde_json::to_string(&*bridge.snapshot()) {
            Ok(json) => Response::json(200, json),
            Err(error) => Response::error(500, error),
        },

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
