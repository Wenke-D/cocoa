//! The backend boundary (specification §26).
//!
//! Everything the UI can do to domain state passes through this trait. The
//! prototype ships one implementation, [`crate::backend::MockBackend`]; a future
//! `ManifestBackend` replaces it without touching the UI.

use chrono::{DateTime, Local};

use crate::backend::snapshot::BackendSnapshot;
use crate::model::{EntityId, ReportState, RunId, RunStatus};

/// What the user asked to cancel.
///
/// Cancelling a Bench run cancels the children it dispatched. Cancelling a
/// single Job run cancels only that run, even when a Bench dispatched it
/// (specification §19).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CancelTarget {
    JobRun(RunId),
    BenchRun(RunId),
}

impl CancelTarget {
    pub fn run_id(&self) -> &RunId {
        match self {
            Self::JobRun(id) | Self::BenchRun(id) => id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BackendError {
    UnknownEntity(EntityId),
    UnknownRun(RunId),
    /// Start was refused because the entity's own manifest is unusable.
    ManifestUnusable {
        entity: String,
        reason: String,
    },
    ParametersRequired,
    /// A Bench plan referenced a Job that cannot be dispatched. Nothing was
    /// started (specification §2.3.2).
    InvalidPlan {
        call_index: usize,
        job: String,
        reason: String,
    },
    NotCancellable {
        reason: String,
    },
    /// A simulated operational failure, used to exercise §31.
    Simulated(String),
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownEntity(id) => write!(f, "No such entity: {id}"),
            Self::UnknownRun(id) => write!(f, "No such run: {id}"),
            Self::ManifestUnusable { entity, reason } => {
                write!(f, "Cannot start {entity}. {reason}")
            }
            Self::ParametersRequired => {
                write!(f, "This experiment requires a parameter string.")
            }
            Self::InvalidPlan {
                call_index,
                job,
                reason,
            } => write!(
                f,
                "Cannot start this Bench.\n\nCall {call_index} references the Job \
                 \"{job}\", which cannot be dispatched: {reason}\n\nNo runs were dispatched."
            ),
            Self::NotCancellable { reason } => write!(f, "Cannot cancel: {reason}"),
            Self::Simulated(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for BackendError {}

pub trait ExperimentBackend {
    /// An immutable view for rendering. Cheap enough to call every frame.
    fn snapshot(&self) -> BackendSnapshot;

    /// Start a Job, or fan a Bench out across existing Jobs.
    ///
    /// Returns the id of the created run: a Job run for a Job, a Bench run for a
    /// Bench. Bench start is atomic — either the Bench run and all of its child
    /// runs exist, or nothing was created.
    fn start(&mut self, entity_id: &EntityId, parameters: String) -> Result<RunId, BackendError>;

    fn cancel(&mut self, target: CancelTarget) -> Result<(), BackendError>;

    fn refresh(&mut self) -> Result<(), BackendError>;

    /// The report's current state, including its format.
    ///
    /// A real backend reads the file here; the error case is a missing run, not
    /// a missing report — an unreadable report is a state, not a failure.
    fn report(&self, run_id: &RunId) -> Result<ReportState, BackendError>;

    /// Advance simulated time. Automatic, not a user-facing operation.
    fn tick(&mut self, now: DateTime<Local>);
}

/// What the Add Demo Folder modal can create (specification §11.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DemoEntityKind {
    Job,
    Bench,
    InvalidManifest,
}

impl DemoEntityKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Job => "Add Demo Job",
            Self::Bench => "Add Demo Bench",
            Self::InvalidManifest => "Add Invalid Manifest",
        }
    }
}

/// Prototype-only controls (specification §28).
///
/// Kept off [`ExperimentBackend`] deliberately. A future `ManifestBackend`
/// implements the boundary above and none of this, at which point the developer
/// controls and the demo-folder flow disappear with it rather than needing to be
/// unpicked from production code.
pub trait PrototypeBackend: ExperimentBackend {
    fn add_demo_entity(&mut self, kind: DemoEntityKind);

    fn is_auto_progressing(&self) -> bool;
    fn set_auto_progressing(&mut self, enabled: bool);

    /// Force a run's next simulated transition.
    fn advance(&mut self, run_id: &RunId);
    fn finish(&mut self, run_id: &RunId, outcome: RunStatus);

    fn toggle_query_unavailable(&mut self, run_id: &RunId);

    fn make_report_available(&mut self, run_id: &RunId);
    fn make_report_missing(&mut self, run_id: &RunId);

    fn generate_history(&mut self, job_id: &EntityId, count: usize);
    fn reset(&mut self, now: DateTime<Local>);
}
