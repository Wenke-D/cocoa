//! Runs.
//!
//! There is exactly one kind of execution record: [`JobRun`]. A run started by
//! the user and a run dispatched by a Bench are the same thing, stored once,
//! distinguished only by [`RunOrigin`] (specification §2.3.1).
//!
//! A [`BenchRun`] is not an execution record. It is a dispatch record: the plan
//! it produced, plus references to the Job runs it started. Its status is
//! derived from those children and is never set directly.

use chrono::{DateTime, Local, TimeDelta};
use serde::{Deserialize, Serialize};

use crate::view_model::entity::EntityId;
use crate::view_model::report::ReportState;
use crate::view_model::status::{QueryHealth, RunStatus};

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct RunId(pub String);

impl RunId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for RunId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// How a run was started.
///
/// Origin is presentation and navigation metadata only. It never changes how a
/// run executes, and it never excludes a run from its Job's own history
/// (specification §10.6).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum RunOrigin {
    Direct,
    BenchStep {
        bench_id: EntityId,
        bench_run_id: RunId,
        step_index: usize,
    },
}

impl RunOrigin {
    pub fn is_direct(&self) -> bool {
        matches!(self, Self::Direct)
    }

    pub fn bench_run_id(&self) -> Option<&RunId> {
        match self {
            Self::Direct => None,
            Self::BenchStep { bench_run_id, .. } => Some(bench_run_id),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct JobRun {
    pub id: RunId,
    /// The Job this run belongs to. Always a real Library entity.
    pub job_id: EntityId,
    pub origin: RunOrigin,
    pub started_at: DateTime<Local>,
    pub ended_at: Option<DateTime<Local>>,
    pub parameters: String,
    pub status: RunStatus,
    pub query_health: QueryHealth,
    pub last_successful_query: DateTime<Local>,
    pub report: ReportState,
    pub error: Option<String>,
}

impl JobRun {
    /// Wall-clock duration: frozen at `ended_at` once the run is over.
    pub fn duration(&self, now: DateTime<Local>) -> TimeDelta {
        self.ended_at.unwrap_or(now) - self.started_at
    }

    /// The status to show the user.
    ///
    /// When query health is unavailable the display status is `Unknown`, but
    /// [`Self::status`] still holds the last known execution status and must
    /// remain visible on the detail page (specification §10.3).
    pub fn display_status(&self) -> DisplayStatus {
        if self.query_health.is_available() {
            DisplayStatus::Known(self.status)
        } else {
            DisplayStatus::Unknown {
                last_known: self.status,
            }
        }
    }
}

/// What the UI prints in a status column.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum DisplayStatus {
    Known(RunStatus),
    Unknown { last_known: RunStatus },
}

impl DisplayStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Known(status) => status.label(),
            Self::Unknown { .. } => "Unknown",
        }
    }
}

/// One call in a Bench plan.
///
/// `index` is a stable display label and identity within the plan. It carries no
/// execution ordering — every call is dispatched at once (specification §10.7).
#[derive(Clone, Debug, Serialize)]
pub struct BenchPlanStep {
    pub index: usize,
    /// References an existing Library Job. The plan never embeds a Job.
    pub job_id: EntityId,
    /// The parameters the Bench derived for this call. Distinct from the Bench's
    /// own input string.
    pub parameters: String,
    pub run_id: RunId,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct BenchPlan {
    pub steps: Vec<BenchPlanStep>,
}

impl BenchPlan {
    pub fn len(&self) -> usize {
        self.steps.len()
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    pub fn step_for_run(&self, run_id: &RunId) -> Option<&BenchPlanStep> {
        self.steps.iter().find(|step| &step.run_id == run_id)
    }

    pub fn run_ids(&self) -> impl Iterator<Item = &RunId> {
        self.steps.iter().map(|step| &step.run_id)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct BenchRun {
    pub id: RunId,
    pub bench_id: EntityId,
    pub started_at: DateTime<Local>,
    pub ended_at: Option<DateTime<Local>>,
    /// The string the user typed in the Start modal. Each dispatched run has its
    /// own derived parameters; do not conflate the two (specification §18.4).
    pub parameters: String,
    pub plan: BenchPlan,
    /// Derived from the children by [`aggregate_status`]. Never set directly.
    pub status: RunStatus,
    pub query_health: QueryHealth,
    pub last_successful_query: DateTime<Local>,
    pub report: ReportState,
    pub error: Option<String>,
}

impl BenchRun {
    pub fn duration(&self, now: DateTime<Local>) -> TimeDelta {
        self.ended_at.unwrap_or(now) - self.started_at
    }

    pub fn display_status(&self) -> DisplayStatus {
        if self.query_health.is_available() {
            DisplayStatus::Known(self.status)
        } else {
            DisplayStatus::Unknown {
                last_known: self.status,
            }
        }
    }
}

/// Counts across a Bench run's dispatched children (specification §18.2).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct BenchProgress {
    pub total: usize,
    pub succeeded: usize,
    pub running: usize,
    pub failed: usize,
    pub cancelled: usize,
    pub errors: usize,
}

impl BenchProgress {
    /// Children that will never change again.
    pub fn finished(self) -> usize {
        self.succeeded + self.failed + self.cancelled + self.errors
    }

    pub fn fraction(self) -> f32 {
        if self.total == 0 {
            return 0.0;
        }
        self.finished() as f32 / self.total as f32
    }
}

/// Derive a Bench run's status from its children (specification §2.3).
///
/// A failing child does not abort its siblings, so the aggregate stays active
/// until every child is terminal. Precedence among terminal outcomes is
/// `Error` > `Failed` > `Cancelled` > `Succeeded`.
pub fn aggregate_status(children: &[RunStatus]) -> RunStatus {
    if children.is_empty() {
        return RunStatus::Succeeded;
    }

    if children.contains(&RunStatus::Cancelling) {
        return RunStatus::Cancelling;
    }

    if children.iter().any(|s| s.is_active()) {
        return if children.iter().all(|s| *s == RunStatus::Starting) {
            RunStatus::Starting
        } else {
            RunStatus::Running
        };
    }

    if children.contains(&RunStatus::Error) {
        RunStatus::Error
    } else if children.contains(&RunStatus::Failed) {
        RunStatus::Failed
    } else if children.contains(&RunStatus::Cancelled) {
        RunStatus::Cancelled
    } else {
        RunStatus::Succeeded
    }
}

pub fn progress_of(children: &[RunStatus]) -> BenchProgress {
    let mut progress = BenchProgress {
        total: children.len(),
        ..Default::default()
    };
    for status in children {
        match status {
            RunStatus::Succeeded => progress.succeeded += 1,
            RunStatus::Failed => progress.failed += 1,
            RunStatus::Cancelled => progress.cancelled += 1,
            RunStatus::Error => progress.errors += 1,
            _ => progress.running += 1,
        }
    }
    progress
}

/// `HH:MM:SS`, used everywhere a duration is displayed.
pub fn format_duration(delta: TimeDelta) -> String {
    let total = delta.num_seconds().max(0);
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    format!("{h:02}:{m:02}:{s:02}")
}

/// "38 seconds ago", used for last-successful-query text (specification §17.4).
pub fn format_relative(then: DateTime<Local>, now: DateTime<Local>) -> String {
    let seconds = (now - then).num_seconds().max(0);
    match seconds {
        0 => "just now".to_owned(),
        1 => "1 second ago".to_owned(),
        2..=59 => format!("{seconds} seconds ago"),
        60..=119 => "1 minute ago".to_owned(),
        120..=3599 => format!("{} minutes ago", seconds / 60),
        3600..=7199 => "1 hour ago".to_owned(),
        _ => format!("{} hours ago", seconds / 3600),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_plan_aggregates_to_succeeded() {
        assert_eq!(aggregate_status(&[]), RunStatus::Succeeded);
    }

    #[test]
    fn all_starting_aggregates_to_starting() {
        let children = [RunStatus::Starting, RunStatus::Starting];
        assert_eq!(aggregate_status(&children), RunStatus::Starting);
    }

    #[test]
    fn a_failed_child_does_not_end_the_bench_while_siblings_run() {
        let children = [RunStatus::Failed, RunStatus::Running];
        assert_eq!(aggregate_status(&children), RunStatus::Running);
    }

    #[test]
    fn failure_outranks_cancellation_once_everything_is_terminal() {
        let children = [
            RunStatus::Failed,
            RunStatus::Cancelled,
            RunStatus::Succeeded,
        ];
        assert_eq!(aggregate_status(&children), RunStatus::Failed);
    }

    #[test]
    fn cancelling_child_shows_as_cancelling() {
        let children = [RunStatus::Cancelling, RunStatus::Succeeded];
        assert_eq!(aggregate_status(&children), RunStatus::Cancelling);
    }

    #[test]
    fn progress_counts_terminal_children() {
        let children = [
            RunStatus::Succeeded,
            RunStatus::Failed,
            RunStatus::Running,
            RunStatus::Cancelled,
        ];
        let progress = progress_of(&children);
        assert_eq!(progress.total, 4);
        assert_eq!(progress.finished(), 3);
        assert_eq!(progress.running, 1);
    }

    #[test]
    fn duration_formats_as_hms() {
        assert_eq!(format_duration(TimeDelta::seconds(378)), "00:06:18");
        assert_eq!(format_duration(TimeDelta::seconds(-5)), "00:00:00");
    }
}
