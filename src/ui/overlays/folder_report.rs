//! What an Add Folder pick refused (specification §11.5).
//!
//! A pick that worked reports in the status bar and opens nothing. This modal
//! exists for the other case: one pick can name a directory holding a dozen
//! experiments, and each folder it turns down has its own reason. Those reasons
//! are the whole content of the message, and a 22px status bar is one line —
//! which is where a list of them goes to be truncated.
//!
//! It only reports. There is no retry and no partial undo: the pick is over,
//! and whatever it did register stays registered.

use crate::adapter::AddedFolders;
use crate::app::{AppCommand, ViewCtx};
use crate::ui::overlays::modal_frame;
use crate::ui::widgets::button::Button;
use crate::ui::widgets::section::Section;
use crate::ui::{space, text};

/// How much of the refusal list is shown before it scrolls. Ten or so lines,
/// which is past the point where the reader is reading rather than counting.
const REFUSAL_LIST_HEIGHT: f32 = 240.0;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, picked: &str, outcome: &AddedFolders) {
    modal_frame(ctx, ui, "add_folder_report", |ctx, ui| {
        ui.label(text::eyebrow("ADD FOLDER"));
        ui.label(text::title(heading(outcome)));

        // What did land, before what did not: the Library has already changed
        // behind this modal, and the reader should not have to infer it from
        // the absence of a name in the refusal list.
        if let Some(line) = registered(outcome) {
            ui.add_space(space::SECTION);
            ui.label(line);
        }

        ui.add_space(space::SECTION);
        ui.add(egui::Label::new(text::mono_muted(picked)).selectable(true));

        ui.add_space(space::SECTION);
        Section::new("NOT ADDED").rule(false).show(ui, |ui| {
            // One pick can look at a whole directory, so the list has no
            // bounded length. It scrolls rather than growing the modal past
            // the window it is centred in.
            egui::ScrollArea::vertical()
                .max_height(REFUSAL_LIST_HEIGHT)
                .auto_shrink([false, true])
                .show(ui, |ui| {
                    for refusal in &outcome.refused {
                        // Not muted: the reason is what the modal is for.
                        ui.label(refusal);
                        ui.add_space(space::SMALL);
                    }
                });
        });

        ui.add_space(space::SECTION);
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if Button::primary("Close").show(ui).clicked() {
                ctx.push(AppCommand::CloseOverlay);
            }
        });
    });
}

/// The title states the outcome, not the count: whether anything else made it
/// in is the first thing the reader wants, and the list below carries the rest.
fn heading(outcome: &AddedFolders) -> &'static str {
    if outcome.added.is_empty() && outcome.already_registered == 0 {
        "Nothing was added"
    } else {
        "Some folders were not added"
    }
}

/// The status bar's own summary, repeated here because the modal covers it.
fn registered(outcome: &AddedFolders) -> Option<String> {
    let mut parts = Vec::new();
    match outcome.added.len() {
        0 => {}
        1 => parts.push(format!("Added {}.", outcome.added[0])),
        count => parts.push(format!("Added {count} folders.")),
    }
    if outcome.already_registered > 0 {
        parts.push(format!(
            "{} already in the library.",
            outcome.already_registered
        ));
    }
    (!parts.is_empty()).then(|| parts.join(" "))
}
