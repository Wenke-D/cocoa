//! The coco engine: the contract between coco and an experiment folder.
//!
//! coco does not run experiments. It renders templates, invokes the folder's
//! own scripts, and maintains that folder's records. Everything coco knows
//! about what an experiment is doing on a cluster, a script told it.

pub mod coco;
pub mod error;
pub mod invoke;
pub mod manifest;
pub mod record;
pub mod status;
pub mod store;
pub mod template;
pub mod words;

pub use coco::{
    BenchStart, BenchStatus, Coco, Config, EntityView, JobRunView, MemberCancel, PlanInstance,
    PollReport, RefreshReport, ReportMode,
};
pub use error::EngineError;
pub use manifest::{BenchManifest, JobManifest, Kind, Manifest};
pub use record::{
    BenchMember, BenchRecord, LaunchFailure, RunOrigin, RunRecord, StatusChange, Trigger,
};
pub use status::Status;
