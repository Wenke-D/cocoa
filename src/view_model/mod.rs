//! What the workbench shows.
//!
//! Not the domain — that is [`crate::coco`], which owns manifests, run records
//! and the store, and which never refers to anything here. These types are the
//! shape the UI renders: a status the user reads ([`status::RunStatus`]) rather
//! than the one a scheduler reported, a folder path already written the way it
//! is displayed, and derivations that exist only to be shown, like
//! [`run::BenchProgress`] and [`status::ManifestState`].
//!
//! Deliberately free of egui, so the same model could be drawn by something
//! other than this UI, and free of backend detail, so a second backend could
//! produce it unchanged.

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
