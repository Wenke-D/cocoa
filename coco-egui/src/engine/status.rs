//! The closed status vocabulary (convention §9).
//!
//! Scripts speak this vocabulary; coco never learns new state names at
//! runtime. The cluster's words come from `poll`. Everything else describes
//! an operation coco itself has in flight, or a conclusion only coco can
//! draw.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Status {
    /// Record written, launch invoked, nothing polled yet (coco).
    Starting,
    /// Accepted by the scheduler, not yet running (poll).
    Pending,
    /// Executing (poll).
    Running,
    /// Work finished successfully; report not run yet (poll).
    Completed,
    /// The report script is in flight (coco).
    Analyzing,
    /// Finished and reported (coco).
    Succeeded,
    /// The work finished unsuccessfully (poll).
    Failed,
    /// Cancel invoked, not yet confirmed by a poll (coco).
    Cancelling,
    /// Confirmed cancelled (poll).
    Cancelled,
    /// coco cannot currently see this run (poll / coco, §10).
    Unreachable,
    /// Something coco did not expect; the reason is shown (coco).
    Error,
}

impl Status {
    pub fn label(self) -> &'static str {
        match self {
            Self::Starting => "STARTING",
            Self::Pending => "PENDING",
            Self::Running => "RUNNING",
            Self::Completed => "COMPLETED",
            Self::Analyzing => "ANALYZING",
            Self::Succeeded => "SUCCEEDED",
            Self::Failed => "FAILED",
            Self::Cancelling => "CANCELLING",
            Self::Cancelled => "CANCELLED",
            Self::Unreachable => "UNREACHABLE",
            Self::Error => "ERROR",
        }
    }

    /// A run that has finished and will never change again.
    ///
    /// `ERROR` is terminal by default; the single healable exception is a run
    /// left at `ERROR` by a failed report script, which a successful manual
    /// report re-run moves to `SUCCEEDED` (§9, §11).
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded | Self::Failed | Self::Cancelled | Self::Error
        )
    }

    /// Whether the run still counts towards the active-run set.
    pub fn is_active(self) -> bool {
        !self.is_terminal()
    }

    /// Whether the user may request cancellation.
    pub fn is_cancellable(self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Pending | Self::Running | Self::Unreachable
        )
    }

    /// The cluster's words, which come from `poll` and nowhere else (§9).
    pub fn is_cluster_word(self) -> bool {
        matches!(
            self,
            Self::Pending
                | Self::Running
                | Self::Completed
                | Self::Failed
                | Self::Cancelled
                | Self::Unreachable
        )
    }

    /// Parses a status word as a poll payload may spell it.
    ///
    /// Returns `None` for words outside the closed vocabulary: coco does not
    /// learn new state names at runtime, so such a line is ignored with a
    /// warning rather than applied.
    pub fn from_poll_word(word: &str) -> Option<Self> {
        Some(match word {
            "PENDING" => Self::Pending,
            "RUNNING" => Self::Running,
            "COMPLETED" => Self::Completed,
            "FAILED" => Self::Failed,
            "CANCELLED" => Self::Cancelled,
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::Status;

    #[test]
    fn terminal_and_active_are_complements() {
        for s in [
            Status::Starting,
            Status::Pending,
            Status::Running,
            Status::Completed,
            Status::Analyzing,
            Status::Succeeded,
            Status::Failed,
            Status::Cancelling,
            Status::Cancelled,
            Status::Unreachable,
            Status::Error,
        ] {
            assert_eq!(s.is_active(), !s.is_terminal(), "{s:?}");
        }
    }

    #[test]
    fn cancellable_set() {
        for s in [
            Status::Starting,
            Status::Pending,
            Status::Running,
            Status::Unreachable,
        ] {
            assert!(s.is_cancellable(), "{s:?}");
        }
        for s in [
            Status::Completed,
            Status::Analyzing,
            Status::Succeeded,
            Status::Failed,
            Status::Cancelling,
            Status::Cancelled,
            Status::Error,
        ] {
            assert!(!s.is_cancellable(), "{s:?}");
        }
    }

    #[test]
    fn poll_words_parse_and_unknown_words_do_not() {
        for (word, status) in [
            ("PENDING", Status::Pending),
            ("RUNNING", Status::Running),
            ("COMPLETED", Status::Completed),
            ("FAILED", Status::Failed),
            ("CANCELLED", Status::Cancelled),
        ] {
            assert_eq!(Status::from_poll_word(word), Some(status));
        }
        assert_eq!(Status::from_poll_word("SUCCEEDED"), None);
        assert_eq!(Status::from_poll_word("DONE"), None);
        assert_eq!(Status::from_poll_word(""), None);
    }
}
