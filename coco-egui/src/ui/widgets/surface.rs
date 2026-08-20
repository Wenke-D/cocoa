//! Blocks that set content apart from the page around it.
//!
//! A card and a callout are the same idea at different volumes: a bounded
//! region with its own ground. Both were private helpers in the files that
//! happened to need them first — `card_frame` in the active-run cards,
//! `notice` in the run detail — which is how two of them ended up with the same
//! 11px inset and 4px radius written out twice.

use crate::ui::{space, text, theme};

/// Inset and corner shared by every raised block, so a card and a callout sit
/// on the same grid.
const INSET: i8 = 11;
const RADIUS: u8 = 4;

/// A bounded block of related facts on its own ground, spanning the content
/// region.
///
/// Used for the active-run cards; anything that is a *unit* the reader scans
/// rather than prose they read.
pub fn card(ui: &mut egui::Ui, contents: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(ui.visuals().faint_bg_color)
        .stroke(ui.visuals().widgets.noninteractive.bg_stroke)
        .inner_margin(egui::Margin::same(INSET))
        .corner_radius(RADIUS)
        .show(ui, |ui| {
            // Every card spans the content region. Without this a card that
            // happens to carry an origin link is wider than one that does not.
            ui.set_width(ui.available_width());
            contents(ui);
        });
    ui.add_space(space::NORMAL);
}

/// A tinted, bordered block that says something about the content near it.
///
/// The tint is derived from [`theme::Level`]'s own colour rather than picked per
/// site, so a warning callout cannot drift towards looking like an error one.
pub fn callout(ui: &mut egui::Ui, level: theme::Level, contents: impl FnOnce(&mut egui::Ui)) {
    let accent = theme::feedback(ui, level);
    egui::Frame::new()
        .fill(accent.gamma_multiply(0.10))
        .stroke(egui::Stroke::new(1.0, accent.gamma_multiply(0.5)))
        .inner_margin(egui::Margin::same(INSET))
        .corner_radius(RADIUS)
        .show(ui, contents);
}

/// A quiet informational line, with no ground of its own.
///
/// The lightest of the three: an active-run notice, a caveat, a hint. When it
/// needs to be noticed, it wants [`callout`] instead.
pub fn notice(ui: &mut egui::Ui, message: impl Into<String>) {
    ui.label(text::caption(message));
}
