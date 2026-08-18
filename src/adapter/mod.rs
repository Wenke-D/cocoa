//! The seam between the workbench and the engine, and its one implementation.
//!
//! ```text
//! UI → Experiments trait → EngineAdapter → coco engine → experiment folder
//! ```
//!
//! This is an adapter, not a domain layer — the domain is [`crate::engine`], and
//! nothing here decides what an experiment *is*. What it does:
//!
//! - owns the engine instance, and is the only thing that may call it;
//! - translates the UI's intent into engine calls, and the engine's failures
//!   into messages a person can read;
//! - maps engine records onto [`crate::view_model`], which is what the UI draws;
//! - decides the cadence — when to poll, when the world is stale.
//!
//! It draws nothing. `egui` does not appear anywhere behind this seam.

pub mod engine;
pub mod traits;

pub use engine::{EngineAdapter, display_path};
pub use traits::{AddedFolders, CancelTarget, ExperimentError, Experiments};
