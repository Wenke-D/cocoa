//! Backend boundary and the prototype's deterministic mock implementation.
//!
//! ```text
//! UI → ExperimentBackend trait → MockBackend
//! ```
//!
//! A future `ManifestBackend` replaces `MockBackend` at this boundary.

pub mod mock;
pub mod snapshot;
pub mod traits;

pub use mock::MockBackend;
pub use snapshot::{BackendSnapshot, World};
pub use traits::{BackendError, CancelTarget, DemoEntityKind, ExperimentBackend, PrototypeBackend};
