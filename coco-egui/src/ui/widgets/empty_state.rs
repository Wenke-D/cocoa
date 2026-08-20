//! Empty states. These must never look like errors (specification §12).

use crate::ui::space;
use crate::ui::widgets::button::Button;

/// A quiet inline note, e.g. "No active runs."
pub fn note(ui: &mut egui::Ui, text: &str) {
    ui.label(crate::ui::text::muted(text));
}

/// A centred page-level empty state with one primary action.
pub fn page(ui: &mut egui::Ui, heading: &str, body: &str, action: Option<&str>) -> bool {
    let mut clicked = false;

    ui.vertical_centered(|ui| {
        ui.add_space(space::PAGE * 3.0);
        ui.label(crate::ui::text::title(heading));
        ui.add_space(space::NORMAL);
        ui.label(crate::ui::text::muted(body));

        if let Some(action) = action {
            ui.add_space(space::SECTION);
            clicked = Button::primary(action).show(ui).clicked();
        }
    });

    clicked
}
