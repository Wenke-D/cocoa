//! coco — an experiment pipeline manager that drives real experiment folders
//! through the folder's own scripts (see `design/CONVENTION.md`).
//!
//! [`crate::coco`] is the engine and the domain; [`crate::view_model`] is what
//! the workbench shows; [`crate::backend`] maps one onto the other, and
//! [`crate::ui`] draws it.

#![warn(clippy::all)]

pub mod app;
pub mod backend;
pub mod coco;
pub mod navigation;
pub mod ui;
pub mod view_model;

pub use app::{APP_TITLE, ExperimentApp};
