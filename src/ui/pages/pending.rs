//! Placeholder bodies for routes whose pages arrive in later phases.
//!
//! The routes themselves are real: breadcrumbs, Library selection, and recovery
//! all work today. Only the page body is outstanding.

use crate::app::ViewCtx;
use crate::ui::space;
use crate::ui::widgets::breadcrumbs;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, title: &str, phase: &str) {
    breadcrumbs::show(ctx, ui);

    ui.heading(title);
    ui.add_space(space::NORMAL);
    ui.label(egui::RichText::new(format!("This page is built in {phase}.")).weak());
}
