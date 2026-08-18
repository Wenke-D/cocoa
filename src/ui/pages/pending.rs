//! Placeholder bodies for routes whose pages arrive in later phases.
//!
//! The routes themselves are real: breadcrumbs, Explorer selection, and recovery
//! all work today. Only the page body is outstanding.

use crate::app::ViewCtx;
use crate::ui::widgets::breadcrumbs;
use crate::ui::{space, text};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, title: &str, phase: &str) {
    breadcrumbs::show(ctx, ui);

    ui.label(text::title(title));
    ui.add_space(space::NORMAL);
    ui.label(text::muted(format!("This page is built in {phase}.")));
}
