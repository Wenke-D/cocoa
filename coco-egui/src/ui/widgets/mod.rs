//! Reusable pieces shared by pages.

pub mod active_run_card;
pub mod breadcrumbs;
pub mod button;
pub mod dispatch_table;
pub mod empty_state;
pub mod form;
pub mod parameter_block;
pub mod progress;
pub mod run_detail;
pub mod run_history_table;
pub mod section;
pub mod status_badge;
pub mod surface;

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
    use crate::ui::theme::metrics;

    let (rect, response) = ui.allocate_exact_size(
        egui::Vec2::splat(metrics::ICON_BUTTON),
        egui::Sense::click(),
    );
    decorate_icon_button(ui, rect, response, tooltip, paint)
}

/// The same button at a rect the caller has already worked out, for rows that
/// are painted rather than laid out — a view header, say.
pub fn icon_button_at(
    ui: &mut egui::Ui,
    rect: egui::Rect,
    id: egui::Id,
    tooltip: &str,
    paint: impl FnOnce(&egui::Painter, egui::Rect, egui::Color32),
) -> egui::Response {
    let response = ui.interact(rect, id, egui::Sense::click());
    decorate_icon_button(ui, rect, response, tooltip, paint)
}

/// The one place an icon action's resting, hovered and held states are decided.
fn decorate_icon_button(
    ui: &mut egui::Ui,
    rect: egui::Rect,
    response: egui::Response,
    tooltip: &str,
    paint: impl FnOnce(&egui::Painter, egui::Rect, egui::Color32),
) -> egui::Response {
    use crate::ui::theme;
    if ui.is_rect_visible(rect) {
        // Hover raises a hit box the icon alone never shows; holding deepens
        // it, so a click that opens something slow is acknowledged at once.
        let color = if response.is_pointer_button_down_on() {
            ui.painter()
                .rect_filled(rect, 3, theme::control(ui, theme::ControlState::Active));
            theme::ink(ui, theme::Ink::Strong)
        } else if response.hovered() {
            ui.painter()
                .rect_filled(rect, 3, theme::control(ui, theme::ControlState::Hover));
            theme::ink(ui, theme::Ink::Strong)
        } else {
            theme::ink(ui, theme::Ink::Normal)
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
