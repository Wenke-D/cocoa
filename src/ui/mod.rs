//! Presentation layer.
//!
//! Layout rule (specification §7.2): the window has exactly two persistent
//! content regions — the Library sidebar on the left and one unified main
//! content region on the right. There is never a third inspector column.
//!
//! Nothing here can reach the backend. Pages receive an immutable snapshot and
//! push [`crate::app::AppCommand`]s, which the app executes after the frame.

pub mod activity_bar;
pub mod icons;
pub mod overlays;
pub mod pages;
pub mod shell;
pub mod sidebar;
pub mod status_bar;
pub mod theme;
pub mod widgets;

/// Spacing scale, roughly 8-point (specification §24.2).
pub mod space {
    pub const SMALL: f32 = 4.0;
    pub const NORMAL: f32 = 8.0;
    pub const SECTION: f32 = 16.0;
    pub const PAGE: f32 = 24.0;
}
