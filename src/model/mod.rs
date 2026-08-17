//! Domain model.
//!
//! Deliberately free of egui and of any backend implementation detail, so that
//! a future `ManifestBackend` can reuse it unchanged.

pub mod entity;
pub mod report;
pub mod run;
pub mod status;

pub use entity::{Entity, EntityId, EntityKind};
pub use report::{ReportFormat, ReportState};
pub use run::{
    BenchPlan, BenchPlanStep, BenchProgress, BenchRun, DisplayStatus, JobRun, RunId, RunOrigin,
    aggregate_status, format_duration, format_relative, progress_of,
};
pub use status::{ManifestState, QueryHealth, RunStatus};
