//! Status badge: painter-drawn marker plus a text label.
//!
//! No emoji — their rendering varies across operating systems (specification
//! §23). The label is always present, so the badge never relies on colour alone.

use crate::model::{DisplayStatus, RunStatus};
use crate::ui::{text, theme};

const MARKER_RADIUS: f32 = 4.0;

/// A marker and its status text, laid out horizontally.
pub fn badge(ui: &mut egui::Ui, display: DisplayStatus) -> egui::Response {
    ui.horizontal(|ui| {
        marker(ui, display);
        ui.add_space(2.0);
        ui.label(text::status(ui, display));
    })
    .response
}

/// Just the marker, for tight cells.
pub fn marker(ui: &mut egui::Ui, display: DisplayStatus) -> egui::Response {
    let diameter = MARKER_RADIUS * 2.0 + 2.0;
    let (rect, response) =
        ui.allocate_exact_size(egui::vec2(diameter, diameter), egui::Sense::hover());

    if ui.is_rect_visible(rect) {
        let style = theme::status_style(ui.visuals().dark_mode, display);
        let center = rect.center();
        if style.filled {
            ui.painter()
                .circle_filled(center, MARKER_RADIUS, style.color);
        } else {
            ui.painter()
                .circle_stroke(center, MARKER_RADIUS, egui::Stroke::new(1.5, style.color));
        }
    }

    response
}

/// Status text without a marker, for places that already have one.
pub fn colored_label(ui: &mut egui::Ui, display: DisplayStatus) {
    ui.label(text::status(ui, display));
}

/// A compact pill for page headers (specification §17.1).
pub fn pill(ui: &mut egui::Ui, display: DisplayStatus) {
    let style = theme::status_style(ui.visuals().dark_mode, display);
    egui::Frame::new()
        .fill(style.color.gamma_multiply(0.18))
        .stroke(egui::Stroke::new(1.0, style.color.gamma_multiply(0.6)))
        .inner_margin(egui::Margin::symmetric(8, 3))
        .corner_radius(3)
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                marker(ui, display);
                ui.add_space(2.0);
                ui.label(text::status_strong(ui, display));
            });
        });
}

/// Explanatory sentence under a status (specification §17.4).
pub fn explanation(display: DisplayStatus) -> &'static str {
    match display {
        DisplayStatus::Unknown { .. } => "The application could not retrieve the current status.",
        DisplayStatus::Known(status) => match status {
            RunStatus::Starting => "The run is being started.",
            RunStatus::Pending => "The run has not started.",
            RunStatus::Running => "The Job is currently being monitored.",
            RunStatus::Completed => "The work finished; the report is being generated.",
            RunStatus::Analyzing => "The report script is running.",
            RunStatus::Succeeded => "The Job reported a successful execution state.",
            RunStatus::Failed => "The Job reported a failed execution state.",
            RunStatus::Cancelling => "Cancellation has been requested.",
            RunStatus::Cancelled => "The run was cancelled.",
            RunStatus::Error => "Something unexpected happened; the reason is shown.",
        },
    }
}
