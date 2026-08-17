//! Bench overview (specification §14).
//!
//! A Bench has no static job list, so this page never claims to know how many
//! Jobs it will dispatch. It reports what the last run actually did.

use crate::app::{AppCommand, ViewCtx};
use crate::model::{BenchRun, Entity};
use crate::ui::pages::job_overview::section_heading;
use crate::ui::space;
use crate::ui::widgets::button::Button;
use crate::ui::widgets::{active_run_card, empty_state, run_history_table};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    header(ctx, ui, entity);
    ui.add_space(space::PAGE);

    active_runs(ctx, ui, entity);
    ui.add_space(space::PAGE);

    all_runs(ctx, ui, entity);
}

fn header(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    // The plan does not exist until Start is pressed, so describe the last run
    // rather than inventing a fixed job count (specification §14.1).
    let subtitle = match ctx.snapshot.bench_history(&entity.id).next() {
        Some(latest) => format!("Last run dispatched {} runs", latest.plan.len()),
        None => "Dispatched runs are determined at start".to_owned(),
    };

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(
                egui::RichText::new(entity.kind.label())
                    .small()
                    .strong()
                    .weak(),
            );
            ui.heading(&entity.name);
            ui.add(
                egui::Label::new(egui::RichText::new(&entity.path).monospace().weak())
                    .selectable(true),
            );
            ui.label(egui::RichText::new(subtitle).weak());
        });

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            let blocked = entity.manifest.blocking_reason();
            let response = Button::primary(entity.kind.start_action())
                .enabled(blocked.is_none())
                .show(ui);

            if let Some(reason) = &blocked {
                response.on_hover_text(reason);
            } else if response.clicked() {
                ctx.push(AppCommand::OpenStartModal(entity.id.clone()));
            }
        });
    });

    if let Some(reason) = entity.manifest.blocking_reason() {
        ui.add_space(space::NORMAL);
        ui.label(egui::RichText::new(reason).color(ui.visuals().error_fg_color));
    }
}

fn active_runs(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    section_heading(ui, "ACTIVE RUNS");

    let active: Vec<&BenchRun> = ctx.snapshot.active_bench_runs_of(&entity.id).collect();
    if active.is_empty() {
        empty_state::note(ui, "No active runs.");
        return;
    }

    for run in active {
        active_run_card::bench_card(ctx, ui, run);
    }
}

fn all_runs(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    section_heading(ui, "ALL RUNS");

    let snapshot = ctx.snapshot;
    let history: Vec<&BenchRun> = snapshot.bench_history(&entity.id).collect();
    let filtered = filter(ctx, &history);

    run_history_table::filter_controls(ctx, ui, filtered.len(), history.len());
    ui.add_space(space::NORMAL);

    if filtered.is_empty() {
        empty_state::note(
            ui,
            if history.is_empty() {
                "This Bench has not been run yet."
            } else {
                "No runs match the current filters."
            },
        );
        return;
    }

    run_history_table::bench_history(ctx, ui, &filtered);
}

fn filter<'a>(ctx: &ViewCtx, history: &[&'a BenchRun]) -> Vec<&'a BenchRun> {
    let needle = ctx.state.run_search.trim().to_lowercase();
    let filter = ctx.state.status_filter;

    history
        .iter()
        .copied()
        .filter(|run| filter.accepts(run.status))
        .filter(|run| needle.is_empty() || run.parameters.to_lowercase().contains(&needle))
        .collect()
}
