//! Reusable pieces shared by pages.

pub mod active_run_card;
pub mod breadcrumbs;
pub mod button;
pub mod dispatch_table;
pub mod empty_state;
pub mod parameter_block;
pub mod progress;
pub mod run_detail;
pub mod run_history_table;
pub mod status_badge;

/// Stop text selection inside a region whose rows navigate when clicked.
///
/// egui labels are selectable by default, and a selectable label swallows the
/// press that would otherwise reach the row behind it: the cell shows an I-beam
/// and the click never opens anything. Only the Parameters column escaped this,
/// because [`parameter_block::truncated_cell`] already opts out.
///
/// Table cells hold timestamps, counts, statuses, and durations — values worth
/// reading, not copying. The values that really are worth copying (parameters,
/// paths, run ids) live on detail pages, where nothing is competing for the
/// click and `parameter_block` keeps them selectable.
pub fn rows_are_clickable(ui: &mut egui::Ui) {
    ui.style_mut().interaction.selectable_labels = false;
}

/// A square, icon-only button, for actions that sit inside a dense row.
///
/// A worded button in a table cell competes with the row it sits in — it is a
/// second, differently-shaped thing to aim at in a space one line tall. An icon
/// with a tooltip says the same thing in the room available, which is what VS
/// Code does everywhere its lists carry per-row actions.
///
/// `paint` takes any of the [`crate::ui::icons`] drawing functions.
pub fn icon_button(
    ui: &mut egui::Ui,
    tooltip: &str,
    paint: impl FnOnce(&egui::Painter, egui::Rect, egui::Color32),
) -> egui::Response {
    use crate::ui::theme::{self, metrics};

    let palette = theme::of(ui);
    let (rect, response) = ui.allocate_exact_size(
        egui::Vec2::splat(metrics::ICON_BUTTON),
        egui::Sense::click(),
    );

    if ui.is_rect_visible(rect) {
        let color = if response.hovered() {
            ui.painter()
                .rect_filled(rect, 3, palette.secondary_hover_bg);
            palette.strong_foreground
        } else {
            palette.foreground
        };
        paint(
            ui.painter(),
            egui::Rect::from_center_size(rect.center(), egui::Vec2::splat(14.0)),
            color,
        );
    }

    response
        .on_hover_cursor(egui::CursorIcon::PointingHand)
        .on_hover_text(tooltip)
}
