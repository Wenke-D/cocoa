//! Start modal (specification §15).
//!
//! Starting is a temporary action, so the parameter field lives here rather than
//! on the overview page.

use crate::app::{AppCommand, ViewCtx};
use crate::model::EntityId;
use crate::navigation::SubmitState;
use crate::ui::overlays::modal_frame;
use crate::ui::space;
use crate::ui::widgets::button::Button;

pub fn show(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    entity_id: &EntityId,
    draft: &str,
    submit_state: &SubmitState,
) {
    let Some(entity) = ctx.snapshot.entity(entity_id).cloned() else {
        ctx.push(AppCommand::CloseOverlay);
        return;
    };

    let active = if entity.is_bench() {
        ctx.snapshot.active_bench_runs_of(entity_id).count()
    } else {
        ctx.snapshot.active_runs_of(entity_id).count()
    };

    let mut text = draft.to_owned();
    let submitting = *submit_state == SubmitState::Submitting;
    let parameters_missing = entity.parameters_required && text.trim().is_empty();
    let can_submit = !submitting && !parameters_missing;
    let mut submit = false;

    // Platform command modifier: ⌘ on macOS, Ctrl elsewhere (specification §15.5).
    // Plain Enter is deliberately not bound, to avoid accidental launches.
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
            // The plan does not exist until Start is pressed, so nothing about
            // it can be previewed here (specification §15.1).
            ui.label(
                egui::RichText::new("The runs to dispatch are determined at start.")
                    .weak()
                    .small(),
            );
        }

        ui.add_space(space::SECTION);
        ui.label("Parameters");
        ui.add_space(space::SMALL);

        let field = ui.add_enabled(
            !submitting,
            egui::TextEdit::singleline(&mut text)
                .hint_text(&entity.default_parameters)
                .font(egui::TextStyle::Monospace)
                .desired_width(f32::INFINITY),
        );
        if std::mem::take(&mut ctx.state.focus_parameter_field) {
            field.request_focus();
        }

        if !entity.default_parameters.trim().is_empty() {
            ui.add_space(space::SMALL);
            ui.label(
                egui::RichText::new(format!("Default: {}", entity.default_parameters))
                    .weak()
                    .small(),
            );
        }

        // One-click restore of the last-used string (specification §15.1).
        if let Some(last) = entity.last_used_parameters.clone()
            && last != text
        {
            ui.add_space(space::SMALL);
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("Last used:").weak().small());
                if ui
                    .link(egui::RichText::new(&last).monospace().small())
                    .on_hover_text("Use these parameters")
                    .clicked()
                {
                    text = last.clone();
                }
            });
        }

        if parameters_missing {
            ui.add_space(space::SMALL);
            ui.label(
                egui::RichText::new("This experiment requires a parameter string.")
                    .color(ui.visuals().error_fg_color)
                    .small(),
            );
        }

        // Informational only — runs are independent (specification §30).
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

        if let SubmitState::Failed(message) = submit_state {
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

    // Never silently discard the draft (specification §36).
    if text != draft {
        ctx.push(AppCommand::UpdateParameterDraft(text.clone()));
    }

    if submit {
        ctx.push(AppCommand::SubmitStart {
            entity_id: entity.id.clone(),
            parameters: text,
        });
    }
}
