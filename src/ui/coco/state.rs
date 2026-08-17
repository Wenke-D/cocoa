//! State and commands for the real-backend (coco) mode.
//!
//! The prototype keeps its own snapshot-based UI untouched. Coco mode drives
//! the engine directly: pages render from immutable engine reads and push
//! commands, which the app executes after the frame against `&mut Coco`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Instant;

use crate::app::TransientMessage;
use crate::coco::PlanInstance;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum CocoRoute {
    #[default]
    Library,
    JobOverview {
        path: PathBuf,
    },
    BenchOverview {
        path: PathBuf,
    },
    JobRunDetail {
        path: PathBuf,
        run_id: u64,
    },
    BenchRunDetail {
        path: PathBuf,
        run_id: u64,
    },
    ReportViewer {
        path: PathBuf,
        run_id: u64,
    },
}

impl CocoRoute {
    /// The entity folder a route belongs to, for sidebar selection.
    pub fn entity_path(&self) -> Option<&PathBuf> {
        match self {
            Self::Library => None,
            Self::JobOverview { path }
            | Self::BenchOverview { path }
            | Self::JobRunDetail { path, .. }
            | Self::BenchRunDetail { path, .. }
            | Self::ReportViewer { path, .. } => Some(path),
        }
    }

    pub fn is_report(&self) -> bool {
        matches!(self, Self::ReportViewer { .. })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum CocoOverlay {
    #[default]
    None,

    RegisterFolder,

    StartJob {
        path: PathBuf,
        fields: BTreeMap<String, String>,
        submitting: bool,
        error: Option<String>,
    },

    StartBench {
        path: PathBuf,
        fields: BTreeMap<String, String>,
        /// The validated plan, shown for confirmation before anything is
        /// submitted (convention §8.1).
        plan: Option<Vec<PlanInstance>>,
        submitting: bool,
        error: Option<String>,
    },

    ConfirmCancelRun {
        path: PathBuf,
        run_id: u64,
    },

    ConfirmCancelBench {
        path: PathBuf,
        run_id: u64,
    },
}

impl CocoOverlay {
    pub fn is_open(&self) -> bool {
        !matches!(self, Self::None)
    }

    pub fn is_dismissible(&self) -> bool {
        !matches!(
            self,
            Self::StartJob {
                submitting: true,
                ..
            } | Self::StartBench {
                submitting: true,
                ..
            }
        )
    }
}

/// Everything the coco UI is allowed to ask for.
#[derive(Clone, Debug)]
pub enum CocoCommand {
    Navigate(CocoRoute),
    Back,

    OpenRegister,
    Register,
    Unregister {
        path: PathBuf,
    },

    OpenStartJob {
        path: PathBuf,
    },
    FillLastArgs {
        path: PathBuf,
    },
    SubmitStartJob {
        path: PathBuf,
    },

    OpenStartBench {
        path: PathBuf,
    },
    PlanBench {
        path: PathBuf,
    },
    DispatchBench {
        path: PathBuf,
    },

    CancelRun {
        path: PathBuf,
        run_id: u64,
    },
    ConfirmCancelRun {
        path: PathBuf,
        run_id: u64,
    },
    CancelBench {
        path: PathBuf,
        run_id: u64,
    },
    ConfirmCancelBench {
        path: PathBuf,
        run_id: u64,
    },

    ReportRun {
        path: PathBuf,
        run_id: u64,
        mode: crate::coco::ReportMode,
    },
    OpenReport {
        path: PathBuf,
        run_id: u64,
    },
    OpenHtmlReport {
        path: PathBuf,
        run_id: u64,
    },

    PollEntity {
        path: PathBuf,
    },
    RefreshAll,
    CloseOverlay,
    SwitchToPrototype,
    Notify(String),
}

#[derive(Default)]
pub struct CocoUiState {
    pub route: CocoRoute,
    pub overlay: CocoOverlay,
    pub register_path: String,
    pub register_error: Option<String>,
    pub transient: Option<TransientMessage>,
    pub last_refresh: Option<Instant>,
    pub last_refresh_errors: Vec<String>,
    pub report_wrap: bool,
}

impl CocoUiState {
    pub fn notify(&mut self, text: impl Into<String>) {
        self.transient = Some(TransientMessage {
            text: text.into(),
            is_error: false,
        });
    }

    pub fn notify_error(&mut self, text: impl Into<String>) {
        self.transient = Some(TransientMessage {
            text: text.into(),
            is_error: true,
        });
    }
}
