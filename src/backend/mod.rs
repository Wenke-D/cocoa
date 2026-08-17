//! Backend boundary and its one real implementation.
//!
//! ```text
//! UI → ExperimentBackend trait → CocoBackend → coco engine → experiment folder
//! ```

pub mod coco;
pub mod snapshot;
pub mod traits;

pub use coco::CocoBackend;
pub use snapshot::{BackendSnapshot, World};
pub use traits::{BackendError, CancelTarget, ExperimentBackend};
