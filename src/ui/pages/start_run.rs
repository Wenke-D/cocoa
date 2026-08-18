//! The Start page (specification §15).
//!
//! A step under the experiment rather than a modal over it: the breadcrumbs
//! already say `solver-gpu > Start`, and a start is a piece of work with its
//! own place, not a dialog to dismiss. The parameter fields live here so that
//! the overview never carries them (§15).
//!
//! One field per declared parameter, all empty at first: no defaults, no
//! prefill (convention §2). Filling from the last run is an explicit button
//! that fills the fields and stops there.

use crate::app::{AppCommand, ViewCtx};
use crate::navigation::{Route, SubmitState};
use crate::ui::theme::metrics;
use crate::ui::widgets::breadcrumbs;
use crate::ui::widgets::button::Button;
use crate::ui::widgets::section::Section;
use crate::ui::widgets::{form, surface};
use crate::ui::{icons, space, text};
use crate::view_model::EntityId;

/// How wide the form gets, however wide the editor is.
///
/// A declared parameter is a short value — a node count, a flag — and a field
/// stretched across a 1500px editor invites a paragraph. The measure the modal
/// used still fits the content; only the surface around it changed.
const FORM_WIDTH: f32 = metrics::MODAL_WIDTH;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity_id: &EntityId) {
    let Some(entity) = ctx.snapshot.entity(entity_id).cloned() else {
        // Recovery runs after this frame; render nothing rather than panic.
        return;
    };

    let mut fields = ctx.state.start_draft.fields.clone();
    let submit_state = ctx.state.start_draft.submit_state.clone();
    let submitting = submit_state == SubmitState::Submitting;

    let active = if entity.is_bench() {
        ctx.snapshot.active_bench_runs_of(entity_id).count()
    } else {
        ctx.snapshot.active_runs_of(entity_id).count()
    };

    let can_submit = !submitting;
    let mut submit = false;
    let mut fill_last = false;
    let submit_shortcut = egui::KeyboardShortcut::new(egui::Modifiers::COMMAND, egui::Key::Enter);
    if can_submit
        && ui
            .ctx()
            .input_mut(|input| input.consume_shortcut(&submit_shortcut))
    {
        submit = true;
    }

    breadcrumbs::show(ctx, ui);

    // The same identity block an entity page uses (specification §13.1):
    // the action as a small type label, the experiment itself as the title.
    // The title stays in the ordinary heading colour — in this theme the
    // accent means "interactive", and a blue title reads as a link.
    ui.label(text::eyebrow(entity.kind.start_action().to_uppercase()));
    ui.label(text::title(&entity.name));

    if entity.is_bench() {
        surface::notice(ui, "The runs to dispatch are determined at start.");
    }

    ui.add_space(space::SECTION);
    ui.set_max_width(FORM_WIDTH);

    let parameters = Section::new("PARAMETERS")
        .note(if entity.parameter_names.is_empty() {
            "(none declared)"
        } else {
            "(all required)"
        })
        .enabled(!submitting)
        .action_if(
            !entity.last_used.is_empty(),
            "Fill from last run",
            icons::history,
        )
        .show(ui, |ui| {
            if entity.parameter_names.is_empty() {
                ui.label(text::caption("This experiment declares no parameters."));
                return Vec::new();
            }

            // A form, so every field starts at the same x however long the
            // longest parameter name is.
            form::fields(ui, "start_parameters", |form| {
                for name in &entity.parameter_names {
                    let value = fields.entry(name.clone()).or_default();
                    form.row(name.as_str(), |ui| {
                        ui.add_enabled(
                            !submitting,
                            egui::TextEdit::singleline(value)
                                .hint_text("required")
                                .font(egui::TextStyle::Monospace)
                                .desired_width(f32::INFINITY),
                        );
                    });
                }
            });

            // Every declared parameter is required (convention §2.1).
            // Catching it here means the user is never told after the fact
            // that a start they already pressed was rejected.
            entity
                .parameter_names
                .iter()
                .filter(|name| {
                    fields
                        .get(*name)
                        .is_none_or(|value| value.trim().is_empty())
                })
                .cloned()
                .collect()
        });

    // Declared parameters still empty. Collected while the fields are drawn, so
    // the button reflects what the user has typed this very frame.
    let empty_fields = parameters.inner;
    fill_last |= parameters.action_clicked;

    if active > 0 {
        ui.add_space(space::SMALL);
        surface::notice(
            ui,
            if active == 1 {
                "1 run of this experiment is already active. \
                 Starting will create another independent run."
                    .to_owned()
            } else {
                format!(
                    "{active} runs of this experiment are already active. \
                     Starting will create another independent run."
                )
            },
        );
    }

    if let SubmitState::Failed(explained) = &submit_state {
        ui.add_space(space::SECTION);
        ui.label(text::error(ui, &explained.lead));

        // Each item is its own label inside its own indent, so a long one
        // wraps under itself. Joined into one label they would wrap back to
        // the left margin and run into the next, and the list would stop
        // reading as a list (§15.4).
        for item in &explained.items {
            ui.add_space(space::SMALL);
            ui.indent(item.as_str(), |ui| {
                ui.label(text::error(ui, item));
            });
        }

        if let Some(note) = &explained.note {
            ui.add_space(space::NORMAL);
            ui.label(text::error(ui, note));
        }
    }

    ui.add_space(space::SECTION);
    ui.horizontal(|ui| {
        // "Back" rather than "Cancel": nothing is pending to call off,
        // and the breadcrumb above says exactly where this goes.
        if Button::secondary("Back")
            .enabled(!submitting)
            .show(ui)
            .clicked()
        {
            ctx.push(AppCommand::Navigate(Route::EntityOverview {
                entity_id: entity.id.clone(),
            }));
        }

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let label = if submitting {
                "Starting…"
            } else {
                entity.kind.start_action()
            };
            let ready = can_submit && empty_fields.is_empty();
            let response = Button::primary(label).enabled(ready).show(ui);
            if response.clicked() {
                submit = true;
            }
            if ready {
                response.on_hover_text(format!(
                    "{} to start",
                    ui.ctx().format_shortcut(&submit_shortcut)
                ));
            } else if !empty_fields.is_empty() {
                response.on_hover_text(format!("Fill in {} to start", empty_fields.join(", ")));
            }
        });
    });

    // Keep what was typed (specification §36).
    ctx.state.start_draft.fields = fields.clone();

    if fill_last {
        ctx.push(AppCommand::FillLastArgs(entity.id.clone()));
    }
    // Gates the keyboard shortcut too: it fires before the fields are drawn.
    if submit && empty_fields.is_empty() {
        ctx.push(AppCommand::SubmitStart {
            entity_id: entity.id.clone(),
            parameters: fields,
        });
    }
}
