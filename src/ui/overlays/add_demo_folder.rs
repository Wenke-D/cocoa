//! Add Demo Folder (specification §11.5).
//!
//! A stand-in for the operating-system folder picker. It reads no filesystem and
//! opens no native dialog; it fabricates entities directly.

use crate::app::{AppCommand, ViewCtx};
use crate::backend::DemoEntityKind;
use crate::ui::overlays::modal_frame;
use crate::ui::space;
use crate::ui::widgets::button::Button;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    modal_frame(ctx, ui, "add_demo_folder", |ctx, ui| {
        ui.heading("Add Demo Folder");
        ui.add_space(space::NORMAL);
        ui.label(
            egui::RichText::new(
                "The prototype fabricates entities instead of reading the filesystem.",
            )
            .weak()
            .small(),
        );

        ui.add_space(space::SECTION);
        for kind in [
            DemoEntityKind::Job,
            DemoEntityKind::Bench,
            DemoEntityKind::InvalidManifest,
        ] {
            let response = Button::secondary(kind.label()).fill_width().show(ui);
            if kind == DemoEntityKind::Bench {
                response
                    .clone()
                    .on_hover_text("The demo Bench calls Jobs that already exist in the Library.");
            }
            if response.clicked() {
                ctx.push(AppCommand::AddDemoEntity(kind));
            }
            ui.add_space(space::SMALL);
        }

        ui.add_space(space::SECTION);
        if Button::secondary("Cancel").show(ui).clicked() {
            ctx.push(AppCommand::CloseOverlay);
        }
    });
}
