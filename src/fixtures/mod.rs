//! Deterministic mock data. Nothing here touches the filesystem.

pub mod demo;
pub mod reports;

pub use demo::{Fixtures, PlanCall, PlanTemplate, derive_parameters};
pub use reports::{ReportKind, ReportLibrary};
