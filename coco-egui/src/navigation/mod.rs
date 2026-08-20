//! Where the user is (`Route`) and what is temporarily in front of them
//! (`Overlay`). These are deliberately separate concerns.

pub mod overlay;
pub mod route;

pub use overlay::{Overlay, SubmitState};
pub use route::{Crumb, Recovery, ReportContext, Route};
