//! coco — an experiment pipeline manager that drives real experiment folders
//! through the folder's own scripts (see `design/CONVENTION.md`).
//!
//! The crate has no mock mode: [`crate::coco`] is the engine and
//! [`crate::ui`] is the desktop app that drives it.

#![warn(clippy::all)]

pub mod app;
pub mod coco;
pub mod ui;

pub use app::{APP_TITLE, ExperimentApp};
