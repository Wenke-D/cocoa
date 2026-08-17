//! Breadcrumbs (specification §9.3), styled as VS Code's editor breadcrumb bar.
//!
//! Breadcrumbs are the authoritative navigation on every detail page. Each
//! ancestor is clickable; the trailing crumb is the current page and is not.
//!
//! A trail of one is not drawn. Its only crumb is the current page, whose name
//! the page header already states in full — an entity overview would otherwise
//! print the entity's name twice, once small and once large, directly above
//! each other. Nothing is lost: with no ancestor there is nowhere to go back to
//! either.

use crate::app::{AppCommand, ViewCtx};
use crate::ui::theme::{self, metrics};
use crate::ui::{icons, space};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let crumbs = ctx.state.route.breadcrumbs(ctx.snapshot);
    if crumbs.len() < 2 {
        return;
    }

    let palette = theme::of(ui);

    ui.horizontal_wrapped(|ui| {
        ui.set_min_height(metrics::BREADCRUMB);
        ui.spacing_mut().item_spacing.x = space::SMALL;

        // A back affordance is offered alongside, never instead of, breadcrumbs.
        let (rect, response) = ui.allocate_exact_size(egui::vec2(20.0, 20.0), egui::Sense::click());
        if response.hovered() {
            ui.painter().rect_filled(rect, 3, palette.row_hover);
        }
        icons::arrow_left(
            ui.painter(),
            egui::Rect::from_center_size(rect.center(), egui::vec2(13.0, 13.0)),
            palette.foreground,
        );
        if response
            .on_hover_cursor(egui::CursorIcon::PointingHand)
            .on_hover_text("Back")
            .clicked()
        {
            ctx.push(AppCommand::NavigateBack);
        }

        for (index, crumb) in crumbs.iter().enumerate() {
            if index > 0 {
                // VS Code separates crumbs with a light chevron, not a slash.
                let (rect, _) =
                    ui.allocate_exact_size(egui::vec2(10.0, 16.0), egui::Sense::hover());
                icons::chevron_right(
                    ui.painter(),
                    egui::Rect::from_center_size(rect.center(), egui::vec2(9.0, 9.0)),
                    palette.description,
                );
            }

            match &crumb.route {
                Some(route) => {
                    let label = egui::RichText::new(&crumb.label)
                        .size(12.0)
                        .color(palette.description);
                    if ui.link(label).clicked() {
                        ctx.push(AppCommand::Navigate(route.clone()));
                    }
                }
                None => {
                    ui.label(
                        egui::RichText::new(&crumb.label)
                            .size(12.0)
                            .color(palette.foreground),
                    );
                }
            }
        }
    });

    ui.add_space(space::SECTION);
}
