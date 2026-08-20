//! Run and bench records (convention §7, §8, §12).
//!
//! A job run's record is the single source of truth for that run: args,
//! submission id, current status, and the full status history with a
//! timestamp per change. A bench record lists what it planned, what it got,
//! and where each member lives; a bench's status is derived on every read and
//! is never stored (§9.1).

use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

use crate::engine::status::Status;

/// One status change in a run's history.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct StatusChange {
    pub status: Status,
    pub at: DateTime<Local>,
}

/// Who asked for a run.
///
/// coco does not assume what an experiment is — only that there are scripts to
/// launch — so this says nothing about the work. It says which surface the
/// request came through, which is the one thing coco itself knows.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    #[default]
    Human,
    Agent,
}

/// How a job run came to exist (convention §12).
///
/// Recorded at dispatch rather than worked out at read time. The alternative —
/// finding the bench by name and scanning its members — has to invent an answer
/// when the bench folder is gone, and a run that outlives its bench then shows a
/// confident wrong call number instead of the name it was actually dispatched
/// under.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "by", rename_all = "snake_case")]
pub enum RunOrigin {
    #[default]
    Human,
    Agent,
    Bench {
        /// The bench *run* that dispatched this one.
        run_id: u64,
        /// The bench's name at dispatch. Kept even when the folder is gone: it
        /// is what the run was dispatched under.
        name: String,
        /// Which call of that run's plan, counted from 1 as the plan's own
        /// validation errors count them (convention §8.1).
        call: usize,
    },
}

impl RunOrigin {
    /// The bench run that dispatched this one, if a bench did.
    pub fn bench_run_id(&self) -> Option<u64> {
        match self {
            Self::Bench { run_id, .. } => Some(*run_id),
            _ => None,
        }
    }
}

/// `runs/<run_id>/run.json` (convention §7.1).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunRecord {
    pub run_id: u64,
    pub submission_id: String,
    pub render: BTreeMap<String, String>,
    pub launch: BTreeMap<String, String>,
    pub status: Status,
    pub history: Vec<StatusChange>,
    /// Free-text reason for the current status when one exists (a `FAILED`
    /// or `UNREACHABLE` line's trailing text, for example).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Captured output attached to an `ERROR` (convention §9, §11).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// How this run came to exist (§8.2).
    #[serde(default)]
    pub origin: RunOrigin,
}

impl RunRecord {
    pub fn new(
        run_id: u64,
        submission_id: String,
        render: BTreeMap<String, String>,
        launch: BTreeMap<String, String>,
        origin: RunOrigin,
        now: DateTime<Local>,
    ) -> Self {
        Self {
            run_id,
            submission_id,
            render,
            launch,
            status: Status::Starting,
            history: vec![StatusChange {
                status: Status::Starting,
                at: now,
            }],
            reason: None,
            error: None,
            origin,
        }
    }

    pub fn started_at(&self) -> DateTime<Local> {
        self.history
            .first()
            .map(|change| change.at)
            .unwrap_or_else(|| {
                self.history
                    .last()
                    .map(|change| change.at)
                    .unwrap_or_default()
            })
    }

    /// The first terminal change's time, if the run has ended (§9).
    pub fn ended_at(&self) -> Option<DateTime<Local>> {
        self.history
            .iter()
            .find(|change| change.status.is_terminal())
            .map(|change| change.at)
    }

    /// Appends a history entry and switches status, carrying the reason only
    /// for statuses that display one.
    pub fn apply_status(&mut self, status: Status, at: DateTime<Local>, reason: Option<String>) {
        self.history.push(StatusChange { status, at });
        self.status = status;
        match status {
            Status::Failed | Status::Unreachable => {
                self.reason = reason.filter(|reason| !reason.is_empty());
            }
            _ => self.reason = None,
        }
    }

    /// The combined render + launch params, one flat map. Unambiguous because
    /// a name cannot appear in both sets (§2.1).
    pub fn all_params(&self) -> BTreeMap<String, String> {
        let mut all = self.render.clone();
        all.extend(self.launch.clone());
        all
    }
}

/// One launched member of a bench run (§8.2).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BenchMember {
    pub run_id: u64,
    /// The member job's platform-wide unique manifest name.
    pub job: String,
}

/// A dispatch that failed while the rest of the fan-out kept going (§8.2).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct LaunchFailure {
    pub job: String,
    pub params: BTreeMap<String, String>,
    pub error: String,
}

/// The bench report lifecycle, recorded so a failed report is not retried on
/// every refresh tick. This is operation metadata, not a stored status (§9.1).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BenchReport {
    pub attempted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// `runs/<run_id>/run.json` for a bench (§8.2).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BenchRecord {
    pub run_id: u64,
    pub bench: String,
    /// Who asked for this bench. Only ever a person or an agent — a bench is
    /// never dispatched by another bench (§2.2).
    #[serde(default)]
    pub by: Trigger,
    pub started_at: DateTime<Local>,
    pub params: BTreeMap<String, String>,
    pub planned: usize,
    pub members: Vec<BenchMember>,
    pub launch_failures: Vec<LaunchFailure>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report: Option<BenchReport>,
}

/// `runs/<run_id>/members.json`, written before a bench report so the script
/// never goes looking across folders (§8.3).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BenchMembersFile {
    pub run_id: u64,
    pub bench: String,
    pub params: BTreeMap<String, String>,
    pub members: Vec<BenchMembersFileMember>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct BenchMembersFileMember {
    pub run_id: u64,
    pub job: String,
    pub params: BTreeMap<String, String>,
    pub submission_id: String,
    /// Absolute path into the member job's folder; never null (§8.3).
    pub report: PathBuf,
}
