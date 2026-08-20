//! The seam an agent drives coco through (specification §43).
//!
//! An agent asks coco to do things; it never runs an experiment's scripts
//! itself. Everything it can ask for arrives here, is handed to the engine's
//! one owner — the worker ([`crate::worker`]) — and takes exactly the path a
//! click takes: the same validation, the same origin stamping, the same
//! screen update. There is no second way into the engine to keep in step with
//! the first.
//!
//! coco must be running. That is a decision, not a limitation to work around:
//! the store has one owner, and the owner lives inside the running window's
//! process. A run started here belongs to the same store the user is looking
//! at, and appears in it as it appears for a click.
//!
//! # Shape
//!
//! ```text
//! socket thread                        worker thread
//!   read request  ─────── queue ──────▶ drain, execute, reply
//!   read snapshot ◀────── published ─── publish after every pass
//! ```
//!
//! Reads are answered from a snapshot the worker publishes, so they never
//! wait on it. Writes go through the queue, because the engine has one owner
//! and this is not it.

pub mod http;
mod server;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, mpsc};

use crate::view_model::Snapshot;

pub use server::{Server, route, socket_path};

/// What the socket asks the workbench to do.
///
/// One variant per operation the interface offers, named for the operation
/// rather than the endpoint: the wire shape is `agent::server`'s business.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Request {
    Start {
        /// The experiment's name, which is unique across the Explorer
        /// (convention §5). An agent should not have to know folder paths.
        experiment: String,
        parameters: BTreeMap<String, String>,
    },
}

/// What the workbench answers.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reply {
    Started { run_id: String },
}

/// A request waiting for the engine's owner, and where to send the answer.
pub struct Pending {
    pub request: Request,
    pub reply: mpsc::Sender<Result<Reply, String>>,
}

/// What the socket thread and the engine's owner share.
///
/// Deliberately small: a queue in one direction, a snapshot in the other, and
/// a way to wake the owner. The owner sleeps when nothing asks for anything,
/// so a request that only sat in the queue would wait out that sleep.
pub struct Bridge {
    queue: Mutex<Vec<Pending>>,
    latest: Mutex<Snapshot>,
    /// Wakes the owner so a queued request is drained now rather than on its
    /// next scheduled look.
    wake: Mutex<Option<Box<dyn Fn() + Send>>>,
}

impl Bridge {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            queue: Mutex::new(Vec::new()),
            latest: Mutex::new(Snapshot::default()),
            wake: Mutex::new(None),
        })
    }

    /// Called once, by whoever owns the engine and drains this queue.
    pub fn attach(&self, wake: impl Fn() + Send + 'static) {
        *self.wake.lock().expect("bridge lock") = Some(Box::new(wake));
    }

    /// Ask the workbench to do something, and wait for it to.
    ///
    /// Blocks the socket thread, never the owner. The timeout is what keeps a
    /// caller from hanging forever if the owner is wedged: a reply is one
    /// pass away in the normal case.
    pub fn submit(&self, request: Request, timeout: std::time::Duration) -> Result<Reply, String> {
        let (sender, receiver) = mpsc::channel();
        self.queue.lock().expect("bridge lock").push(Pending {
            request,
            reply: sender,
        });
        if let Some(wake) = self.wake.lock().expect("bridge lock").as_ref() {
            wake();
        }
        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => Err("coco did not answer in time".to_owned()),
        }
    }

    /// Everything queued since the last look.
    pub fn take_pending(&self) -> Vec<Pending> {
        std::mem::take(&mut *self.queue.lock().expect("bridge lock"))
    }

    /// The owner publishes what it last built.
    ///
    /// Cheap: a snapshot is an `Arc` clone (specification §26.1).
    pub fn publish(&self, snapshot: Snapshot) {
        *self.latest.lock().expect("bridge lock") = snapshot;
    }

    /// The last published snapshot. At most one pass old, which is what a read
    /// over a socket is anyway.
    pub fn snapshot(&self) -> Snapshot {
        self.latest.lock().expect("bridge lock").clone()
    }
}

/// Where the socket lives.
///
/// One fixed path: an agent should not have to discover a port or be told a
/// number, and two coco windows over two stores is not a case this prototype
/// serves (specification §43).
pub fn default_socket_path() -> PathBuf {
    if let Ok(path) = std::env::var("COCO_SOCKET_PATH") {
        return PathBuf::from(path);
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join(".local/share/coco/coco.sock");
    }
    PathBuf::from("coco.sock")
}
