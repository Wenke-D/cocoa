//! The real-backend (coco) mode's presentation layer.
//!
//! Same workbench shape as the prototype — one sidebar, one main region — but
//! driven directly by the [`crate::coco::Coco`] engine instead of the mock.
//! Pages read the engine immutably and push [`CocoCommand`]s, which the app
//! executes after the frame.

pub mod overlays;
pub mod pages;
pub mod sidebar;
pub mod state;
pub mod status;

use crate::coco::Coco;
use crate::ui::coco::state::{CocoCommand, CocoUiState};
use crate::ui::space;
use crate::ui::theme;

pub fn show(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
) {
    keyboard(ui, state, commands);
    let palette = theme::of(ui);

    top_strip(ui, coco, commands, palette);

    let panel = egui::Panel::left("coco_sidebar")
        .default_size(220.0)
        .size_range(egui::Rangef::new(180.0, 300.0))
        .frame(theme::side_bar_frame(palette))
        .show(ui, |ui| sidebar::show(ui, coco, state, commands));
    let _ = panel;

    egui::CentralPanel::default()
        .frame(theme::editor_frame(palette))
        .show(ui, |ui| {
            egui::ScrollArea::vertical()
                .auto_shrink([false, false])
                .show(ui, |ui| {
                    ui.add_space(space::SECTION);
                    egui::Frame::new()
                        .inner_margin(egui::Margin::symmetric(
                            theme::metrics::EDITOR_PADDING as i8,
                            0,
                        ))
                        .show(ui, |ui| pages::show(ui, coco, state, commands));
                    ui.add_space(space::PAGE);
                });
        });

    overlays::show(ui, coco, state, commands);
}

/// A slim strip identifying the mode. It is chrome for development, not a
/// content region.
fn top_strip(
    ui: &mut egui::Ui,
    coco: &Coco,
    commands: &mut Vec<CocoCommand>,
    palette: &'static theme::Palette,
) {
    egui::Panel::top("coco_top_strip")
        .exact_size(28.0)
        .frame(
            egui::Frame::new()
                .fill(palette.secondary_bg)
                .inner_margin(egui::Margin::symmetric(
                    space::NORMAL as i8,
                    space::SMALL as i8,
                )),
        )
        .show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("coco — real backend")
                        .small()
                        .strong()
                        .color(palette.accent),
                );
                ui.label(
                    egui::RichText::new(coco.store_path().display().to_string())
                        .small()
                        .monospace()
                        .color(palette.description),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui
                        .small_button("Prototype mode")
                        .on_hover_text("Switch back to the deterministic mock UI")
                        .clicked()
                    {
                        commands.push(CocoCommand::SwitchToPrototype);
                    }
                    if ui
                        .small_button("Refresh")
                        .on_hover_text("Poll every job and advance reports now")
                        .clicked()
                    {
                        commands.push(CocoCommand::RefreshAll);
                    }
                });
            });
        });
}

fn keyboard(ui: &mut egui::Ui, state: &mut CocoUiState, commands: &mut Vec<CocoCommand>) {
    if ui.input(|i| i.key_pressed(egui::Key::Escape))
        && state.overlay.is_open()
        && state.overlay.is_dismissible()
    {
        commands.push(CocoCommand::CloseOverlay);
    }
}
