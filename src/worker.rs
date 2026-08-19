//! The engine's owner, off the frame loop.
//!
//! The store has one owner. It used to be the window's frame loop; it is now
//! this worker, on its own thread, and the window became what the agent
//! interface already was — a client. Both reach the engine through one door:
//!
//! ```text
//! UI thread                 worker thread                socket thread
//!   send(WorkCommand) ────▶ recv, execute ◀──── take_pending (Bridge)
//!   apply WorkEvents  ◀──── emit outcomes
//!   render Snapshot   ◀──── publish after every pass ──▶ agent reads
//! ```
//!
//! Commands are fire-and-forget: a start is *launched* the moment it is asked
//! for, and everything that happens next — the run id, a refusal, a failure —
//! comes back as data, either an event or the next snapshot. Nothing on the
//! UI thread ever waits for a script.
//!
//! The agent's requests are drained here too, so an agent still cannot reach
//! anything a person could not, and cannot reach it by a path with different
//! rules (specification §43).

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use chrono::{DateTime, Local};

use crate::adapter::{AddedFolders, CancelTarget, Experiments, Explained};
use crate::view_model::{EntityId, EntityKind, ReportState, RunId, Snapshot, Trigger};

/// What the window asks the worker to do. One variant per operation; the
/// worker answers with [`WorkEvent`]s and with the next snapshot.
#[derive(Clone, Debug)]
pub enum WorkCommand {
    /// Start on behalf of the person at the window (§10.6). The agent's
    /// starts arrive through the [`crate::agent::Bridge`], not here, because
    /// the trigger is a property of the surface the request came through.
    Start {
        entity_id: EntityId,
        parameters: BTreeMap<String, String>,
    },
    Cancel(CancelTarget),
    Refresh,
    RetryQuery(RunId),
    RegisterFolder(PathBuf),
    /// Write the run's report somewhere a browser can read and answer with
    /// the URL to open.
    OpenReportExternally(RunId),
}

/// What the worker tells the window. Outcomes travel as data because the
/// worker cannot touch the UI; the window applies them on its next frame.
#[derive(Clone, Debug)]
pub enum WorkEvent {
    /// A start went through. Carries what the window needs to land on the new
    /// run without holding any state of its own while it waited.
    Started {
        entity_id: EntityId,
        kind: Option<EntityKind>,
        run_id: RunId,
    },
    StartRefused {
        entity_id: EntityId,
        error: Explained,
    },
    CancelSucceeded {
        target: CancelTarget,
    },
    CancelFailed {
        target: CancelTarget,
        message: String,
    },
    FoldersAdded {
        picked: String,
        /// The first entity this action added, for the window to land on.
        first_new: Option<EntityId>,
        outcome: AddedFolders,
    },
    OpenUrl(String),
    Notice(String),
    ErrorNotice(String),
}

enum Work {
    Command(WorkCommand),
    /// Wakes the loop so the agent's queue is drained now. Sent by the
    /// bridge; carries nothing because the queue is the message.
    Poke,
    /// The window is closing. An explicit message rather than a channel
    /// disconnect, because the bridge's wake closure holds a sender clone —
    /// through the worker's own hands — so the channel never disconnects
    /// while the worker lives.
    Shutdown,
}

/// The window's end: a sender, an event drain, and the latest snapshot.
///
/// Dropping it is the shutdown signal: the worker sees the channel close,
/// settles what is still in flight, and only then does the drop return —
/// so the process cannot exit under a launch script's feet (§10).
pub struct Handle {
    sender: mpsc::Sender<Work>,
    events: mpsc::Receiver<WorkEvent>,
    latest: Arc<Mutex<Snapshot>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Handle {
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = self.sender.send(Work::Shutdown);
            let _ = thread.join();
        }
    }
}

impl Handle {
    pub fn send(&self, command: WorkCommand) {
        let _ = self.sender.send(Work::Command(command));
    }

    /// The last published snapshot. Cheap: an `Arc` clone (§26.1).
    pub fn snapshot(&self) -> Snapshot {
        self.latest.lock().expect("latest lock").clone()
    }

    /// The next outcome waiting to be applied, if any. Never blocks.
    pub fn next_event(&self) -> Option<WorkEvent> {
        self.events.try_recv().ok()
    }
}

/// The engine and everything that may drive it.
pub struct Worker {
    experiments: Box<dyn Experiments + Send>,
    inbox: mpsc::Receiver<Work>,
    events: mpsc::Sender<WorkEvent>,
    latest: Arc<Mutex<Snapshot>>,
    published: Snapshot,
    #[cfg(unix)]
    bridge: Option<Arc<crate::agent::Bridge>>,
    ui: Option<egui::Context>,
    /// Set by [`Work::Shutdown`], wherever in a pass it is drained.
    stop: bool,
}

/// How long the loop sleeps when nothing asks for anything. Short enough that
/// a due poll or a finished launch is collected promptly; the adapter itself
/// decides whether a refresh is actually due.
const IDLE: Duration = Duration::from_millis(500);

impl Worker {
    fn new(
        experiments: Box<dyn Experiments + Send>,
        #[cfg(unix)] bridge: Option<Arc<crate::agent::Bridge>>,
        ui: Option<egui::Context>,
    ) -> (Self, Handle) {
        let (sender, inbox) = mpsc::channel();
        let (events, event_drain) = mpsc::channel();
        // The first snapshot exists before the first frame or request can ask
        // for one.
        let first = experiments.snapshot();
        let latest = Arc::new(Mutex::new(first.clone()));
        #[cfg(unix)]
        if let Some(bridge) = &bridge {
            bridge.publish(first.clone());
            let poke = sender.clone();
            bridge.attach(move || {
                let _ = poke.send(Work::Poke);
            });
        }
        let worker = Self {
            experiments,
            inbox,
            events,
            latest: Arc::clone(&latest),
            published: first,
            #[cfg(unix)]
            bridge,
            ui,
            stop: false,
        };
        let handle = Handle {
            sender,
            events: event_drain,
            latest,
            thread: None,
        };
        (worker, handle)
    }

    /// The production shape: the worker on its own thread, waking the window
    /// whenever the world changes. `ui` is `None` only where there is no
    /// window to wake — a test driving the thread for real.
    pub fn spawn(
        experiments: Box<dyn Experiments + Send>,
        #[cfg(unix)] bridge: Option<Arc<crate::agent::Bridge>>,
        ui: Option<egui::Context>,
    ) -> io::Result<Handle> {
        let (worker, mut handle) = Self::new(
            experiments,
            #[cfg(unix)]
            bridge,
            ui,
        );
        handle.thread = Some(
            std::thread::Builder::new()
                .name("coco-worker".to_owned())
                .spawn(move || worker.run())?,
        );
        Ok(handle)
    }

    /// The test shape: the same worker, pumped by the caller, so every
    /// outcome is observable synchronously. No thread, no timing.
    pub fn local(experiments: Box<dyn Experiments + Send>) -> (Self, Handle) {
        Self::new(
            experiments,
            #[cfg(unix)]
            None,
            None,
        )
    }

    fn run(mut self) {
        loop {
            match self.inbox.recv_timeout(IDLE) {
                Ok(work) => self.handle(work),
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => self.stop = true,
            }
            if !self.stop {
                self.pass(Local::now());
            }
            if self.stop {
                // The window is gone; so is anyone to answer. What is still
                // in flight gets its moment to land before the process does
                // (§10) — the window's drop is waiting on this thread.
                self.experiments.shutdown();
                return;
            }
        }
    }

    /// One full pass: everything queued, the agent's queue, housekeeping,
    /// publish. This is the whole loop body, kept callable so tests drive it
    /// without a thread.
    pub fn step(&mut self, now: DateTime<Local>) {
        self.pass(now);
    }

    fn pass(&mut self, now: DateTime<Local>) {
        while let Ok(work) = self.inbox.try_recv() {
            self.handle(work);
        }
        #[cfg(unix)]
        self.serve_agent();
        self.experiments.tick(now);
        self.publish();
    }

    fn handle(&mut self, work: Work) {
        match work {
            Work::Poke => {}
            Work::Shutdown => self.stop = true,
            Work::Command(command) => self.execute(command),
        }
    }

    fn execute(&mut self, command: WorkCommand) {
        match command {
            WorkCommand::Start {
                entity_id,
                parameters,
            } => {
                let kind = self
                    .experiments
                    .snapshot()
                    .entity(&entity_id)
                    .map(|entity| entity.kind);
                match self
                    .experiments
                    .start(&entity_id, parameters, Trigger::Human)
                {
                    Ok(run_id) => self.emit(WorkEvent::Started {
                        entity_id,
                        kind,
                        run_id,
                    }),
                    Err(error) => self.emit(WorkEvent::StartRefused {
                        entity_id,
                        error: error.explain(),
                    }),
                }
            }

            WorkCommand::Cancel(target) => match self.experiments.cancel(target.clone()) {
                Ok(()) => self.emit(WorkEvent::CancelSucceeded { target }),
                Err(error) => self.emit(WorkEvent::CancelFailed {
                    target,
                    message: error.to_string(),
                }),
            },

            WorkCommand::Refresh => match self.experiments.refresh() {
                Ok(()) => self.emit(WorkEvent::Notice("Refreshed.".to_owned())),
                Err(error) => self.emit(WorkEvent::ErrorNotice(error.to_string())),
            },

            WorkCommand::RetryQuery(run_id) => {
                let _ = self.experiments.refresh();
                let healthy = self
                    .experiments
                    .snapshot()
                    .job_run(&run_id)
                    .is_none_or(|run| run.query_health.is_available());
                if healthy {
                    self.emit(WorkEvent::Notice("Query succeeded.".to_owned()));
                } else {
                    self.emit(WorkEvent::ErrorNotice(
                        "The status is still unavailable.".to_owned(),
                    ));
                }
            }

            WorkCommand::RegisterFolder(path) => self.register_folder(&path),

            WorkCommand::OpenReportExternally(run_id) => self.open_report_externally(&run_id),
        }
    }

    fn register_folder(&mut self, path: &Path) {
        let before: Vec<EntityId> = self
            .experiments
            .snapshot()
            .entities
            .iter()
            .map(|entity| entity.id.clone())
            .collect();
        let picked = crate::adapter::display_path(path);

        let outcome = match self.experiments.register_folder(path) {
            Ok(outcome) => outcome,
            // A pick that named exactly one folder reports that folder's
            // refusal as the call's error rather than in the tally. Same
            // event for the user, so it gets the same modal.
            Err(error) => {
                self.emit(WorkEvent::FoldersAdded {
                    picked,
                    first_new: None,
                    outcome: AddedFolders {
                        refused: vec![error.to_string()],
                        ..AddedFolders::default()
                    },
                });
                return;
            }
        };

        let first_new = self
            .experiments
            .snapshot()
            .entities
            .iter()
            .find(|entity| !before.contains(&entity.id))
            .map(|entity| entity.id.clone());
        self.emit(WorkEvent::FoldersAdded {
            picked,
            first_new,
            outcome,
        });
    }

    fn open_report_externally(&mut self, run_id: &RunId) {
        let state = match self.experiments.report(run_id) {
            Ok(state) => state,
            Err(error) => {
                self.emit(WorkEvent::ErrorNotice(error.to_string()));
                return;
            }
        };

        let ReportState::Available { format, text } = state else {
            self.emit(WorkEvent::ErrorNotice(
                "That report is not available.".to_owned(),
            ));
            return;
        };

        let path = std::env::temp_dir().join(format!(
            "experiment-report-{run_id}.{}",
            format.file_extension()
        ));

        match std::fs::write(&path, text.as_bytes()) {
            Ok(()) => {
                self.emit(WorkEvent::OpenUrl(format!("file://{}", encode_path(&path))));
                self.emit(WorkEvent::Notice(
                    "Opening the report in your browser…".to_owned(),
                ));
            }
            Err(error) => self.emit(WorkEvent::ErrorNotice(format!(
                "Could not write the report: {error}"
            ))),
        }
    }

    /// Runs whatever the agent interface has queued, and answers it.
    ///
    /// Every request goes through the same call a click goes through, so an
    /// agent cannot reach anything a person could not (specification §43).
    #[cfg(unix)]
    fn serve_agent(&mut self) {
        let Some(bridge) = self.bridge.clone() else {
            return;
        };
        for pending in bridge.take_pending() {
            let answer = match pending.request {
                crate::agent::Request::Start {
                    experiment,
                    parameters,
                } => self.start_by_name(&experiment, parameters),
            };
            // The caller may have hung up; that is their business.
            let _ = pending.reply.send(answer);
        }
    }

    /// Starts an experiment named rather than addressed.
    ///
    /// An agent knows `solver-gpu`, not the folder it lives in. Names are
    /// unique across the Explorer (convention §5), so the lookup is total.
    #[cfg(unix)]
    fn start_by_name(
        &mut self,
        name: &str,
        parameters: BTreeMap<String, String>,
    ) -> Result<crate::agent::Reply, String> {
        let snapshot = self.experiments.snapshot();
        let Some(entity) = snapshot.entities.iter().find(|entity| entity.name == name) else {
            return Err(format!("No such entity: {name}"));
        };
        let entity_id = entity.id.clone();
        drop(snapshot);

        match self
            .experiments
            .start(&entity_id, parameters, Trigger::Agent)
        {
            Ok(run_id) => Ok(crate::agent::Reply::Started {
                run_id: run_id.to_string(),
            }),
            Err(error) => Err(error.to_string()),
        }
    }

    /// Sends one outcome to the window — publishing first, so an event never
    /// describes a world the window cannot see yet. A `Started` applied
    /// against a snapshot without the run would navigate to a page the route
    /// recovery immediately takes away again.
    fn emit(&mut self, event: WorkEvent) {
        self.publish();
        let _ = self.events.send(event);
        if let Some(ui) = &self.ui {
            ui.request_repaint();
        }
    }

    /// Publishes what this pass produced, if anything changed. The world is
    /// rebuilt only when something marked it dirty, so pointer identity is
    /// change detection — an unchanged world wakes nobody.
    fn publish(&mut self) {
        let snapshot = self.experiments.snapshot();
        if snapshot.same_world(&self.published) {
            return;
        }
        self.published = snapshot.clone();
        *self.latest.lock().expect("latest lock") = snapshot.clone();
        #[cfg(unix)]
        if let Some(bridge) = &self.bridge {
            bridge.publish(snapshot);
        }
        if let Some(ui) = &self.ui {
            ui.request_repaint();
        }
    }
}

fn encode_path(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|c| match c {
            ' ' => "%20".to_owned(),
            '#' => "%23".to_owned(),
            '?' => "%3F".to_owned(),
            other => other.to_string(),
        })
        .collect()
}
