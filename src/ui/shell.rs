//! The persistent application shell.
//!
//! Laid out as VS Code's workbench, in the order the panels claim space:
//!
//! ```text
//! ┌────┬───────────┬─────────────────────────────┐
//! │ ac │ side bar  │ editor                      │
//! │ ti │           │                             │
//! │ vi │           │                             │
//! ├────┴───────────┴─────────────────────────────┤
//! │ status bar                                   │
//! └──────────────────────────────────────────────┘
//! ```
//!
//! There is no in-window title bar (specification §8). The platform draws one
//! carrying the application name; Add lives on the Library header's "+", the
//! theme in the activity bar's gear, and the active-run count in both the status
//! bar and the activity bar's badge.
//!
//! The activity bar is chrome for choosing the sidebar's view, not a content
//! region: there are still exactly two of those, and never a third column
//! (specification §7.2).

use crate::app::{SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, ViewCtx};
use crate::ui::{activity_bar, overlays, pages, sidebar, space, status_bar, theme};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    keyboard(ctx, ui);

    status_bar::show(ctx, ui);
    activity_bar::show(ctx, ui);

    if ctx.state.sidebar_open {
        let panel = egui::Panel::left("library")
            .resizable(true)
            .default_size(ctx.state.sidebar_width)
            .size_range(egui::Rangef::new(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))
            .frame(theme::side_bar_frame(ui))
            .show(ui, |ui| sidebar::show(ctx, ui));

        // Remember whatever width the user dragged to.
        ctx.state.sidebar_width = panel.response.rect.width();
    }

    egui::CentralPanel::default()
        .frame(theme::editor_frame(ui))
        .show(ui, |ui| {
            egui::ScrollArea::vertical()
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    ui.add_space(space::SECTION);
                    // Editor content keeps VS Code's generous side gutters.
                    egui::Frame::new()
                        .inner_margin(egui::Margin::symmetric(
                            theme::metrics::EDITOR_PADDING as i8,
                            0,
                        ))
                        .show(ui, |ui| pages::show(ctx, ui));
                    ui.add_space(space::PAGE);
                });
        });

    overlays::show(ctx, ui);
}

/// Global shortcuts (specification §25). Modal-local keys live with the modals.
fn keyboard(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let command_f = egui::KeyboardShortcut::new(egui::Modifiers::COMMAND, egui::Key::F);

    // Only meaningful in the report viewer, and only when explicitly invoked.
    if ctx.state.route.is_report() && ui.ctx().input_mut(|i| i.consume_shortcut(&command_f)) {
        ctx.state.focus_report_search = true;
    }
}
