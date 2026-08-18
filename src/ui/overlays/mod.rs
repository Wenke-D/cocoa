//! Modal overlays (specification §15, §16).
//!
//! A modal is a temporary action, never a place: overlay state lives outside the
//! route and is never persisted.

pub mod cancel_modal;
pub mod start_modal;

use crate::app::{AppCommand, ViewCtx};
use crate::navigation::Overlay;
use crate::ui::theme::{self, metrics};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let overlay = ctx.state.overlay.clone();

    match overlay {
        Overlay::None => {}
        Overlay::StartRun { entity_id, .. } => start_modal::show(ctx, ui, &entity_id),
        Overlay::ConfirmCancel { target, error } => {
            cancel_modal::show(ctx, ui, &target, error.as_deref())
        }
        Overlay::Settings => {}
    }
}

/// Shared modal chrome. Returns whether the user dismissed it from outside.
pub fn modal_frame<R>(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    id: &str,
    contents: impl FnOnce(&mut ViewCtx, &mut egui::Ui) -> R,
) {
    let dismissible = ctx.state.overlay.is_dismissible();

    let frame = theme::modal_frame(ui);

    let response = egui::Modal::new(egui::Id::new(id))
        .frame(frame)
        .show(ui.ctx(), |ui| {
            ui.set_max_width(metrics::MODAL_WIDTH);
            contents(ctx, ui);
        });

    if dismissible && response.should_close() {
        ctx.push(AppCommand::CloseOverlay);
    }
}
