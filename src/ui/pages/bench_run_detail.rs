//! Bench run detail (specification §18).
//!
//! Uses the full main-content width. There is no current step and no pending
//! call: a Bench dispatches everything at once, so this page reports counts and
//! lists runs, never a position in a sequence.

use crate::app::{AppCommand, ViewCtx};
use crate::backend::CancelTarget;
use crate::navigation::{ReportContext, Route};
use crate::ui::widgets::button::Button;
use crate::ui::widgets::section::Section;
use crate::ui::widgets::{
    breadcrumbs, dispatch_table, parameter_block, progress as progress_bar, status_badge,
};
use crate::ui::{space, text};
use crate::view_model::{EntityId, ReportState, RunId, format_duration, format_relative};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, bench_id: &EntityId, run_id: &RunId) {
    breadcrumbs::show(ctx, ui);

    let Some(bench_run) = ctx.snapshot.bench_run(run_id).cloned() else {
        return;
    };

    header(ctx, ui, bench_id, &bench_run);
    ui.add_space(space::PAGE);

    progress_summary(ctx, ui, &bench_run);
    ui.add_space(space::PAGE);

    Section::new("BENCH PARAMETERS").show_heading(ui);
    ui.label(text::caption(
        "The string the user typed. Each dispatched run has its own derived parameters.",
    ));
    ui.add_space(space::SMALL);
    parameter_block::block(ui, &bench_run.parameters);
    ui.add_space(space::PAGE);

    Section::new("DISPATCHED RUNS").show_heading(ui);
    dispatch_table::show(ctx, ui, &bench_run);
    ui.add_space(space::SECTION);

    report_section(ctx, ui, bench_id, &bench_run);
}

fn header(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    bench_id: &EntityId,
    bench_run: &crate::view_model::BenchRun,
) {
    let name = ctx.snapshot.entity_name(bench_id).to_owned();

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.heading(&name);
            ui.label(text::muted(format!(
                "Run {}",
                bench_run.started_at.format("%Y-%m-%d %H:%M:%S")
            )));
        });

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if bench_run.status.is_cancellable()
                && Button::secondary("Cancel Bench").show(ui).clicked()
            {
                ctx.push(AppCommand::RequestCancel(CancelTarget::BenchRun(
                    bench_run.id.clone(),
                )));
            }
            if bench_run.report.is_available()
                && Button::secondary("Open Bench Report").show(ui).clicked()
            {
                ctx.push(AppCommand::Navigate(Route::ReportViewer {
                    context: ReportContext::BenchRun {
                        bench_id: bench_id.clone(),
                    },
                    run_id: bench_run.id.clone(),
                }));
            }
        });
    });

    ui.add_space(space::NORMAL);
    status_badge::pill(ui, bench_run.display_status());
}

fn progress_summary(ctx: &mut ViewCtx, ui: &mut egui::Ui, bench_run: &crate::view_model::BenchRun) {
    let now = ctx.now;
    let progress = ctx.snapshot.bench_progress(bench_run);

    Section::new("PROGRESS").show_heading(ui);

    ui.label(format!(
        "{} / {} finished · {} succeeded · {} running · {} failed · {} cancelled · {} errors",
        progress.finished(),
        progress.total,
        progress.succeeded,
        progress.running,
        progress.failed,
        progress.cancelled,
        progress.errors
    ));
    ui.add_space(space::NORMAL);

    progress_bar::bar(ui, &ctx.snapshot.child_statuses(bench_run));

    ui.add_space(space::NORMAL);
    ui.label(text::muted(format!(
        "Started {} · Duration {} · Last successful query {}",
        bench_run.started_at.format("%H:%M:%S"),
        format_duration(bench_run.duration(now)),
        format_relative(bench_run.last_successful_query, now)
    )));

    // A failure that has not yet ended the Bench deserves saying out loud
    // (specification §18.2).
    if progress.failed > 0 && bench_run.status.is_active() {
        ui.add_space(space::NORMAL);
        ui.label(text::warning(
            ui,
            "A dispatched run has failed. Its siblings are unaffected and keep running; \
                 this Bench resolves once every run is finished.",
        ));
    }
}

fn report_section(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    bench_id: &EntityId,
    bench_run: &crate::view_model::BenchRun,
) {
    Section::new("BENCH REPORT").show_heading(ui);

    match &bench_run.report {
        ReportState::Available { .. } => {
            if Button::secondary("Open Bench Report").show(ui).clicked() {
                ctx.push(AppCommand::Navigate(Route::ReportViewer {
                    context: ReportContext::BenchRun {
                        bench_id: bench_id.clone(),
                    },
                    run_id: bench_run.id.clone(),
                }));
            }
        }
        other => {
            ui.label(text::muted(other.summary()));
        }
    }
}
