//! Modal overlay state.
//!
//! Kept out of [`crate::navigation::Route`] deliberately (specification §9): a
//! modal is a temporary action, not a place. Overlay state is never persisted.

use std::collections::BTreeMap;

use crate::adapter::{AddedFolders, CancelTarget, Explained};
use crate::view_model::EntityId;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum SubmitState {
    #[default]
    Idle,
    Submitting,
    /// Submission failed. The user's parameter draft is preserved
    /// (specification §31).
    ///
    /// Held in parts rather than as one string: a Bench plan can fail on
    /// several calls at once, and the modal lays those out one per paragraph
    /// (§15.4).
    Failed(Explained),
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Overlay {
    #[default]
    None,

    StartRun {
        entity_id: EntityId,
        /// One field per declared parameter, by name (convention §2).
        fields: BTreeMap<String, String>,
        submit_state: SubmitState,
    },

    ConfirmCancel {
        target: CancelTarget,
        /// Set when a cancellation attempt failed.
        error: Option<String>,
    },

    /// What an Add Folder pick refused, and what it managed to register
    /// alongside (specification §11.5). Opened only when something was
    /// refused: a pick that fully worked reports in the status bar.
    AddFolderReport {
        /// The directory the user picked, as the workbench writes it (§24.4).
        /// A refused folder is one of many a pick can find, so the modal says
        /// where it was looking.
        picked: String,
        outcome: AddedFolders,
    },

    Settings,
}

impl Overlay {
    pub fn is_open(&self) -> bool {
        !matches!(self, Self::None)
    }

    /// Escape and backdrop clicks must not interrupt an in-flight submission
    /// (specification §15.5).
    pub fn is_dismissible(&self) -> bool {
        !matches!(
            self,
            Self::StartRun {
                submit_state: SubmitState::Submitting,
                ..
            }
        )
    }
}
