//! Execution status, query health, and manifest validity.
//!
//! The central rule of this module (specification §10.3):
//!
//! ```text
//! Execution Failed ≠ Query Unavailable
//! ```
//!
//! [`RunStatus`] is what the experiment is doing. [`QueryHealth`] is whether we
//! were able to find out. Losing query contact must never overwrite the last
//! known execution status.

/// What a run is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RunStatus {
    Starting,
    Pending,
    Running,
    Succeeded,
    Failed,
    Cancelling,
    Cancelled,
}

impl RunStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Starting => "Starting",
            Self::Pending => "Pending",
            Self::Running => "Running",
            Self::Succeeded => "Succeeded",
            Self::Failed => "Failed",
            Self::Cancelling => "Cancelling",
            Self::Cancelled => "Cancelled",
        }
    }

    /// A run that has finished and will never change again.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }

    /// A run that still counts towards the active-run count.
    pub fn is_active(self) -> bool {
        !self.is_terminal()
    }

    /// Whether the user may request cancellation.
    pub fn is_cancellable(self) -> bool {
        matches!(self, Self::Starting | Self::Pending | Self::Running)
    }
}

/// Whether the application can currently see a run's status.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum QueryHealth {
    #[default]
    Healthy,
    Delayed,
    Unavailable {
        message: String,
    },
}

impl QueryHealth {
    pub fn is_available(&self) -> bool {
        !matches!(self, Self::Unavailable { .. })
    }
}

/// Validity of an entity's manifest. Invalid or missing disables Start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManifestState {
    Valid,
    Invalid { message: String },
    Missing,
}

impl ManifestState {
    pub fn is_valid(&self) -> bool {
        matches!(self, Self::Valid)
    }

    /// Why Start is disabled, or `None` when it is not.
    pub fn blocking_reason(&self) -> Option<String> {
        match self {
            Self::Valid => None,
            Self::Invalid { message } => Some(format!("Manifest is invalid: {message}")),
            Self::Missing => Some("No manifest was found in this folder.".to_owned()),
        }
    }
}
