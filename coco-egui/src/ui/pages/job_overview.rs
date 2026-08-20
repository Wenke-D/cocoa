//! Job overview (specification §13).
//!
//! Viewing outranks starting: current state, active runs, history, and reports
//! come first. The parameter field lives in a modal, never on this page.

use crate::app::{AppCommand, ViewCtx};
use crate::ui::widgets::button::Button;
use crate::ui::widgets::section::Section;
use crate::ui::widgets::{active_run_card, empty_state, run_history_table};
use crate::ui::{space, text};
use crate::view_model::{Entity, JobRun};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    header(ctx, ui, entity);
    ui.add_space(space::PAGE);

    active_runs(ctx, ui, entity);
    ui.add_space(space::PAGE);

    all_runs(ctx, ui, entity);
}

fn header(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(text::eyebrow(entity.kind.label()));
            ui.label(text::title(&entity.name));
            ui.add(egui::Label::new(text::mono_muted(&entity.path)).selectable(true));
        });

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            start_button(ctx, ui, entity);
        });
    });

    // An unusable manifest disables Start and says why (specification §13.1).
    if let Some(reason) = entity.manifest.blocking_reason() {
        ui.add_space(space::NORMAL);
        ui.label(text::error(ui, reason));
    }
}

fn start_button(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    let blocked = entity.manifest.blocking_reason();
    let active = ctx.snapshot.active_runs_of(&entity.id).count();

    // Runs are independent, so an active run never blocks Start
    // (specification §30). Only the wording changes.
    let label = if active > 0 {
        "Start Another Run".to_owned()
    } else {
        entity.kind.start_action().to_owned()
    };

    let response = Button::primary(&label).enabled(blocked.is_none()).show(ui);

    if let Some(reason) = &blocked {
        response.on_hover_text(reason);
    } else if response.clicked() {
        ctx.push(AppCommand::OpenStartPage(entity.id.clone()));
    }
}

fn active_runs(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    Section::new("ACTIVE RUNS").show(ui, |ui| {
        let active: Vec<&JobRun> = ctx.snapshot.active_runs_of(&entity.id).collect();
        if active.is_empty() {
            empty_state::note(ui, "No active runs.");
            return;
        }
        for run in active {
            active_run_card::job_card(ctx, ui, run);
        }
    });
}

fn all_runs(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    Section::new("ALL RUNS").show(ui, |ui| {
        let snapshot = ctx.snapshot;
        let history: Vec<&JobRun> = snapshot.job_history(&entity.id).collect();
        let filtered = filter(ctx, &history);

        run_history_table::filter_controls(ctx, ui, filtered.len(), history.len());
        ui.add_space(space::NORMAL);

        if filtered.is_empty() {
            empty_state::note(
                ui,
                if history.is_empty() {
                    "This Job has not been run yet."
                } else {
                    "No runs match the current filters."
                },
            );
            return;
        }

        run_history_table::job_history(ctx, ui, &filtered);
    });
}

/// Filters affect All Runs only, never Active Runs (specification §22.4).
fn filter<'a>(ctx: &ViewCtx, history: &[&'a JobRun]) -> Vec<&'a JobRun> {
    let needle = ctx.state.run_search.trim().to_lowercase();
    let filter = ctx.state.status_filter;

    history
        .iter()
        .copied()
        .filter(|run| filter.accepts(run.status))
        .filter(|run| needle.is_empty() || run.parameters.to_lowercase().contains(&needle))
        .collect()
}
