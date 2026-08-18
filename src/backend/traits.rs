//! The backend boundary.
//!
//! Everything the UI can do to domain state passes through this trait. The
//! single implementation is [`crate::backend::coco::CocoBackend`], which
//! drives the [`crate::coco`] engine over real experiment folders.

use std::collections::BTreeMap;
use std::path::Path;

use chrono::{DateTime, Local};

use crate::backend::snapshot::BackendSnapshot;
use crate::model::{EntityId, ReportState, RunId};

/// What the user asked to cancel.
///
/// Cancelling a Bench run cancels the children it dispatched. Cancelling a
/// single Job run cancels only that run, even when a Bench dispatched it.
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
    /// started.
    InvalidPlan {
        call_index: usize,
        job: String,
        reason: String,
    },
    NotCancellable {
        reason: String,
    },
    /// Any other operational failure, with the reason.
    Operation(String),
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
            Self::Operation(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for BackendError {}

/// What one Add Folder action did.
///
/// A pick can name several experiment folders at once, so the outcome is a
/// tally rather than a single success: the folders newly registered, the ones
/// already in the library, and the ones refused with their reason.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AddedFolders {
    /// Folder names newly registered, in the order they were found.
    pub added: Vec<String>,
    /// Folders that were already in the library.
    pub already_registered: usize,
    /// Folders that could not be registered, each with its reason.
    pub refused: Vec<String>,
}

pub trait ExperimentBackend {
    /// An immutable view for rendering. Cheap to call every frame.
    fn snapshot(&self) -> BackendSnapshot;

    /// Start a Job, or fan a Bench out across existing Jobs.
    ///
    /// `parameters` is the flat map of declared parameter names to values
    /// (convention §2: every declared parameter must be supplied by hand).
    /// Returns the id of the created run: a Job run for a Job, a Bench run
    /// for a Bench. Bench start is atomic — either the Bench run and all of
    /// its child runs exist, or nothing was created.
    fn start(
        &mut self,
        entity_id: &EntityId,
        parameters: BTreeMap<String, String>,
    ) -> Result<RunId, BackendError>;

    fn cancel(&mut self, target: CancelTarget) -> Result<(), BackendError>;

    fn refresh(&mut self) -> Result<(), BackendError>;

    /// The report's current state, including its format. An unreadable report
    /// is a state, not a failure; a missing run is the error case.
    fn report(&self, run_id: &RunId) -> Result<ReportState, BackendError>;

    /// Registers the folder the user picked (specification §11.5).
    ///
    /// When the picked directory carries no manifest of its own, every
    /// experiment folder beneath it is registered instead, so one pick can
    /// add a whole library (the bundled `mock/` directory, say). A folder
    /// already in the library is a no-op.
    fn register_folder(&mut self, path: &Path) -> Result<AddedFolders, BackendError>;

    /// Automatic housekeeping (polling, reports, bench fan-out progression).
    fn tick(&mut self, now: DateTime<Local>);
}
