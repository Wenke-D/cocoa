//! coco — an experiment pipeline manager that drives real experiment folders
//! through the folder's own scripts (see `design/CONVENTION.md`).
//!
//! [`crate::engine`] is the engine and the domain; [`crate::view_model`] is what
//! the workbench shows; [`crate::adapter`] maps one onto the other,
//! [`crate::worker`] owns it all on its own thread, and [`crate::ui`] draws it.

#![warn(clippy::all)]

pub mod adapter;
#[cfg(unix)]
pub mod agent;
pub mod app;
pub mod engine;
pub mod navigation;
pub mod ui;
pub mod view_model;
pub mod worker;

pub use app::{APP_TITLE, ExperimentApp};
