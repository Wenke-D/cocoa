//! Presentation layer.
//!
//! Layout rule: the window has exactly two persistent content regions — the
//! Library sidebar on the left and one unified main content region on the
//! right. Pages read the coco engine immutably and push
//! [`crate::ui::coco::state::CocoCommand`]s, which the app executes after the
//! frame.

pub mod coco;
pub mod theme;

/// Spacing scale, roughly 8-point (specification §24.2).
pub mod space {
    pub const SMALL: f32 = 4.0;
    pub const NORMAL: f32 = 8.0;
    pub const SECTION: f32 = 16.0;
    pub const PAGE: f32 = 24.0;
}
