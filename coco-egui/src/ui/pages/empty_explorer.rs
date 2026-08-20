//! Empty Explorer page (specification §12).
//!
//! This must not look like an error.

use crate::app::{AppCommand, ViewCtx};
use crate::ui::widgets::empty_state;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let clicked = empty_state::page(
        ui,
        "No jobs or benches have been added.",
        "Add a folder containing a valid experiment manifest to begin.",
        Some("Add Folder"),
    );

    if clicked {
        ctx.push(AppCommand::AddFolder);
    }
}
