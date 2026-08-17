//! Status pills for the coco vocabulary (convention §9).
//!
//! Never colour alone: the label is always present, and the marker is
//! painter-drawn rather than an emoji whose rendering varies by platform.

use crate::coco::Status;
use crate::ui::theme::{self, Palette};

const MARKER_RADIUS: f32 = 4.0;

fn color(palette: &Palette, status: Status) -> egui::Color32 {
    match status {
        Status::Starting => palette.chart_blue,
        Status::Pending => palette.chart_gray,
        Status::Running => palette.chart_blue,
        Status::Completed => palette.chart_green,
        Status::Analyzing => palette.chart_yellow,
        Status::Succeeded => palette.chart_green,
        Status::Failed => palette.chart_red,
        Status::Cancelling => palette.chart_yellow,
        Status::Cancelled => palette.chart_gray,
        Status::Unreachable => palette.warning,
        Status::Error => palette.error,
    }
}

fn filled(status: Status) -> bool {
    matches!(
        status,
        Status::Running | Status::Succeeded | Status::Failed | Status::Error
    )
}

/// Marker plus label.
pub fn badge(ui: &mut egui::Ui, status: Status) -> egui::Response {
    ui.horizontal(|ui| {
        marker(ui, status);
        ui.add_space(2.0);
        let color = color(theme::of(ui), status);
        ui.label(egui::RichText::new(status.label()).color(color));
    })
    .response
}

/// Just the marker, for tight table cells.
pub fn marker(ui: &mut egui::Ui, status: Status) -> egui::Response {
    let diameter = MARKER_RADIUS * 2.0 + 2.0;
    let (rect, response) =
        ui.allocate_exact_size(egui::vec2(diameter, diameter), egui::Sense::hover());
    if ui.is_rect_visible(rect) {
        let palette = theme::of(ui);
        let color = color(palette, status);
        let center = rect.center();
        if filled(status) {
            ui.painter().circle_filled(center, MARKER_RADIUS, color);
        } else {
            ui.painter()
                .circle_stroke(center, MARKER_RADIUS, egui::Stroke::new(1.5, color));
        }
    }
    response
}

/// A compact pill for headers and tables.
pub fn pill(ui: &mut egui::Ui, status: Status) {
    let palette = theme::of(ui);
    let color = color(palette, status);
    egui::Frame::new()
        .fill(color.gamma_multiply(0.18))
        .stroke(egui::Stroke::new(1.0, color.gamma_multiply(0.6)))
        .inner_margin(egui::Margin::symmetric(8, 3))
        .corner_radius(3)
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                marker(ui, status);
                ui.add_space(2.0);
                ui.label(egui::RichText::new(status.label()).color(color));
            });
        });
}
