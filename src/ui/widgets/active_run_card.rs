//! Active-run cards (specification §13.2, §14.2).
//!
//! Cards sit above historical runs and are never affected by the history
//! filters (specification §22.4).

use crate::app::{AppCommand, ViewCtx};
use crate::backend::CancelTarget;
use crate::model::{BenchRun, JobRun, RunOrigin, format_duration};
use crate::navigation::Route;
use crate::ui::widgets::button::Button;
use crate::ui::widgets::{parameter_block, progress, status_badge, surface};
use crate::ui::{space, text};

/// A card for one active Job run.
pub fn job_card(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &JobRun) {
    let now = ctx.now;
    let snapshot = ctx.snapshot;

    surface::card(ui, |ui| {
        ui.horizontal(|ui| {
            status_badge::badge(ui, run.display_status());

            // A run a Bench dispatched says so, and links back to the Bench run.
            if let RunOrigin::BenchStep {
                bench_id,
                bench_run_id,
                ..
            } = &run.origin
            {
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let label = format!("from {}", snapshot.entity_name(bench_id));
                    if ui.link(label).clicked() {
                        ctx.push(AppCommand::Navigate(Route::BenchRunDetail {
                            bench_id: bench_id.clone(),
                            run_id: bench_run_id.clone(),
                        }));
                    }
                });
            }
        });

        ui.add_space(space::SMALL);
        ui.label(text::muted(format!(
            "Started {} · Duration {}",
            run.started_at.format("%H:%M:%S"),
            format_duration(run.duration(now))
        )));

        ui.add_space(space::SMALL);
        parameter_block::truncated_cell(ui, &run.parameters);

        ui.add_space(space::NORMAL);
        ui.horizontal(|ui| {
            if Button::secondary("Open").show(ui).clicked() {
                ctx.push(AppCommand::Navigate(Route::JobRunDetail {
                    job_id: run.job_id.clone(),
                    run_id: run.id.clone(),
                }));
            }
            if run.status.is_cancellable() && Button::secondary("Cancel").show(ui).clicked() {
                ctx.push(AppCommand::RequestCancel(CancelTarget::JobRun(
                    run.id.clone(),
                )));
            }
        });
    });
}

/// A card for one active Bench run.
///
/// Shows a completion count over the dispatched calls. There is no "current
/// step" — nothing is sequenced (specification §14.2).
pub fn bench_card(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &BenchRun) {
    let now = ctx.now;
    let progress = ctx.snapshot.bench_progress(run);
    let statuses = ctx.snapshot.child_statuses(run);

    surface::card(ui, |ui| {
        status_badge::badge(ui, run.display_status());

        ui.add_space(space::SMALL);
        ui.label(format!(
            "{} of {} runs completed · {} running",
            progress.finished(),
            progress.total,
            progress.running
        ));

        ui.add_space(space::SMALL);
        progress::bar(ui, &statuses);

        ui.add_space(space::SMALL);
        ui.label(text::muted(format!(
            "Started {} · Duration {}",
            run.started_at.format("%H:%M:%S"),
            format_duration(run.duration(now))
        )));

        ui.add_space(space::NORMAL);
        ui.horizontal(|ui| {
            if Button::secondary("Open").show(ui).clicked() {
                ctx.push(AppCommand::Navigate(Route::BenchRunDetail {
                    bench_id: run.bench_id.clone(),
                    run_id: run.id.clone(),
                }));
            }
            if run.status.is_cancellable() && Button::secondary("Cancel").show(ui).clicked() {
                ctx.push(AppCommand::RequestCancel(CancelTarget::BenchRun(
                    run.id.clone(),
                )));
            }
        });
    });
}
