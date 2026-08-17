//! Experiment manager prototype.
//!
//! Working title only — see the naming note in the specification. The product
//! model is: a **Job** is an independently runnable experiment, and a **Bench**
//! is a fan-out launcher that returns a list of calls to Jobs that already exist
//! in the Library. A Bench is not a pipeline and owns no Jobs.

#![warn(clippy::all)]

pub mod app;
pub mod backend;
pub mod fixtures;
pub mod model;
pub mod navigation;
pub mod ui;

pub use app::{APP_TITLE, ExperimentApp};
