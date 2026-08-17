//! Add Folder: register a real experiment folder by path.

use crate::app::{AppCommand, ViewCtx};
use crate::ui::overlays::modal_frame;
use crate::ui::space;
use crate::ui::widgets::button::Button;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    modal_frame(ctx, ui, "add_folder", |ctx, ui| {
        ui.heading("Add Folder");
        ui.add_space(space::NORMAL);
        ui.label(
            egui::RichText::new("Path to an experiment folder containing a coco.toml manifest.")
                .weak()
                .small(),
        );

        ui.add_space(space::SECTION);
        let response = ui.add(
            egui::TextEdit::singleline(&mut ctx.state.register_path)
                .font(egui::TextStyle::Monospace)
                .desired_width(f32::INFINITY),
        );
        if response.changed() {
            ctx.state.register_error = None;
        }

        if let Some(error) = &ctx.state.register_error {
            ui.add_space(space::SMALL);
            ui.label(egui::RichText::new(error).color(ui.visuals().error_fg_color));
        }

        ui.add_space(space::SMALL);
        if Button::secondary("Add bundled mock library")
            .show(ui)
            .on_hover_text("Registers every folder under the repo's mock/ directory")
            .clicked()
        {
            ctx.push(AppCommand::RegisterMockLibrary);
        }

        ui.add_space(space::SECTION);
        ui.horizontal(|ui| {
            if Button::secondary("Cancel").show(ui).clicked() {
                ctx.push(AppCommand::CloseOverlay);
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if Button::primary("Register").show(ui).clicked() {
                    ctx.push(AppCommand::RegisterFolder {
                        path: ctx.state.register_path.clone(),
                    });
                }
            });
        });
    });
}
