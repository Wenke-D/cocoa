//! Start modal.
//!
//! Starting is a temporary action, so the parameter fields live here rather
//! than on the overview page. One field per declared parameter, all empty at
//! first: no defaults, no prefill (convention §2). Filling from the last run
//! is an explicit button that fills the fields and stops there.

use crate::app::{AppCommand, ViewCtx};
use crate::model::EntityId;
use crate::navigation::{Overlay, SubmitState};
use crate::ui::overlays::modal_frame;
use crate::ui::space;
use crate::ui::widgets::button::Button;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity_id: &EntityId) {
    let Some(entity) = ctx.snapshot.entity(entity_id).cloned() else {
        ctx.push(AppCommand::CloseOverlay);
        return;
    };

    let (mut fields, submit_state) = match &ctx.state.overlay {
        Overlay::StartRun {
            fields,
            submit_state,
            ..
        } => (fields.clone(), submit_state.clone()),
        _ => return,
    };
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

    modal_frame(ctx, ui, "start_run", |ctx, ui| {
        ui.heading(entity.kind.start_action());
        ui.add_space(space::NORMAL);
        ui.label(egui::RichText::new(&entity.name).strong());

        if entity.is_bench() {
            ui.label(
                egui::RichText::new("The runs to dispatch are determined at start.")
                    .weak()
                    .small(),
            );
        }

        ui.add_space(space::SECTION);
        ui.label("Parameters");
        ui.add_space(space::SMALL);

        if entity.parameter_names.is_empty() {
            ui.label(
                egui::RichText::new("This experiment declares no parameters.")
                    .weak()
                    .small(),
            );
        } else {
            for name in &entity.parameter_names {
                let value = fields.entry(name.clone()).or_default();
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new(name.as_str())
                            .monospace()
                            .weak()
                            .small(),
                    );
                    ui.add_enabled(
                        !submitting,
                        egui::TextEdit::singleline(value)
                            .hint_text("required")
                            .font(egui::TextStyle::Monospace)
                            .desired_width(f32::INFINITY),
                    );
                });
            }
            ui.add_space(space::SMALL);
        }

        if !entity.last_used.is_empty() {
            ui.add_space(space::SMALL);
            if Button::secondary("Fill from last run")
                .enabled(!submitting)
                .show(ui)
                .clicked()
            {
                fill_last = true;
            }
        }

        if active > 0 {
            ui.add_space(space::SMALL);
            ui.label(
                egui::RichText::new(format!(
                    "{active} run(s) of this experiment are already active. \
                     Starting will create another independent run."
                ))
                .weak()
                .small(),
            );
        }

        if let SubmitState::Failed(message) = &submit_state {
            ui.add_space(space::SECTION);
            ui.label(egui::RichText::new(message).color(ui.visuals().error_fg_color));
        }

        ui.add_space(space::SECTION);
        ui.horizontal(|ui| {
            if Button::secondary("Cancel")
                .enabled(!submitting)
                .show(ui)
                .clicked()
            {
                ctx.push(AppCommand::CloseOverlay);
            }

            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let label = if submitting {
                    "Starting…"
                } else {
                    entity.kind.start_action()
                };
                let response = Button::primary(label).enabled(can_submit).show(ui);
                if response.clicked() {
                    submit = true;
                }
                if can_submit {
                    response.on_hover_text(format!(
                        "{} to start",
                        ui.ctx().format_shortcut(&submit_shortcut)
                    ));
                }
            });
        });
    });

    // Keep the draft in the overlay (specification §36).
    if let Overlay::StartRun { fields: slot, .. } = &mut ctx.state.overlay {
        *slot = fields.clone();
    }

    if fill_last {
        ctx.push(AppCommand::FillLastArgs(entity.id.clone()));
    }
    if submit {
        ctx.push(AppCommand::SubmitStart {
            entity_id: entity.id.clone(),
            parameters: fields,
        });
    }
}
