//! coco — an experiment pipeline manager that drives real experiment folders
//! through the folder's own scripts (see `design/CONVENTION.md`).
//!
//! [`crate::coco`] is the engine; [`crate::backend`] adapts it to the UI's
//! snapshot model; [`crate::ui`] is the desktop app.

#![warn(clippy::all)]

pub mod app;
pub mod backend;
pub mod coco;
pub mod model;
pub mod navigation;
pub mod ui;

pub use app::{APP_TITLE, ExperimentApp};
