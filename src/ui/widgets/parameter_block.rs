//! Selectable monospace blocks for parameters, IDs, and paths
//! (specification §24.1, §36).

use crate::ui::space;

/// A full, untruncated, selectable parameter string.
pub fn block(ui: &mut egui::Ui, parameters: &str) {
    let text = if parameters.trim().is_empty() {
        "(no parameters)"
    } else {
        parameters
    };

    egui::Frame::new()
        .fill(ui.visuals().extreme_bg_color)
        .inner_margin(egui::Margin::symmetric(
            space::NORMAL as i8,
            space::SMALL as i8,
        ))
        .corner_radius(3)
        .show(ui, |ui| {
            ui.add(
                egui::Label::new(egui::RichText::new(text).monospace())
                    .selectable(true)
                    .wrap(),
            );
        });
}

/// A one-line monospace value, selectable, for IDs and paths.
pub fn inline(ui: &mut egui::Ui, text: &str) {
    ui.add(egui::Label::new(egui::RichText::new(text).monospace()).selectable(true));
}

/// Truncated for a table cell, with the full value on hover
/// (specification §22.3).
pub fn truncated_cell(ui: &mut egui::Ui, text: &str) {
    let display = if text.trim().is_empty() { "—" } else { text };
    ui.add(
        egui::Label::new(egui::RichText::new(display).monospace())
            .truncate()
            .selectable(false),
    )
    .on_hover_text(display);
}
