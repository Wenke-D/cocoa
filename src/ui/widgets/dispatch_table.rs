//! The Bench dispatch table (specification §18.3).
//!
//! Every run the plan dispatched, one row per call. `Call` is a stable display
//! label, not an execution order — nothing here is sequenced.
//!
//! `Parameters` is mandatory: a plan commonly calls one Job many times, and the
//! parameter string is the only thing telling those rows apart.

use egui_extras::{Column, TableBuilder};

use crate::app::{AppCommand, ViewCtx};
use crate::navigation::{ReportContext, Route};
use crate::ui::icons;
use crate::ui::text;
use crate::ui::widgets::{icon_button, parameter_block, rows_are_clickable, status_badge};
use crate::view_model::{BenchRun, format_duration};

const ROW_HEIGHT: f32 = 24.0;
const HEADER_HEIGHT: f32 = 22.0;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, bench_run: &BenchRun) {
    let now = ctx.now;
    let snapshot = ctx.snapshot;
    let bench_id = bench_run.bench_id.clone();
    let bench_run_id = bench_run.id.clone();
    let steps = &bench_run.plan.steps;

    rows_are_clickable(ui);

    TableBuilder::new(ui)
        .id_salt("dispatch_table")
        .striped(true)
        .sense(egui::Sense::click())
        .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
        .column(Column::exact(48.0)) // Call
        .column(Column::initial(160.0).at_least(110.0).clip(true)) // Job
        .column(Column::remainder().at_least(160.0).clip(true)) // Parameters
        .column(Column::exact(110.0)) // Status
        .column(Column::exact(90.0)) // Started
        .column(Column::exact(80.0)) // Duration
        .column(Column::exact(70.0)) // Report
        .min_scrolled_height(0.0)
        .header(HEADER_HEIGHT, |mut header| {
            for title in [
                "Call",
                "Job",
                "Parameters",
                "Status",
                "Started",
                "Duration",
                "Report",
            ] {
                header.col(|ui| {
                    ui.label(text::table_header(title));
                });
            }
        })
        .body(|body| {
            body.rows(ROW_HEIGHT, steps.len(), |mut row| {
                let step = &steps[row.index()];
                let run = snapshot.job_run(&step.run_id);
                let mut consumed = false;

                row.col(|ui| {
                    ui.label(text::muted(step.index.to_string()));
                });
                row.col(|ui| {
                    ui.label(snapshot.entity_name(&step.job_id));
                });
                row.col(|ui| parameter_block::truncated_cell(ui, &step.parameters));

                row.col(|ui| match run {
                    Some(run) => {
                        status_badge::badge(ui, run.display_status());
                    }
                    None => {
                        ui.label(text::none());
                    }
                });
                row.col(|ui| {
                    // All calls are dispatched together, so these start times
                    // are expected to match.
                    ui.label(match run {
                        Some(run) => run.started_at.format("%H:%M:%S").to_string(),
                        None => "—".to_owned(),
                    });
                });
                row.col(|ui| {
                    ui.label(match run {
                        Some(run) => format_duration(run.duration(now)),
                        None => "—".to_owned(),
                    });
                });
                row.col(|ui| {
                    let available = run.is_some_and(|run| run.report.is_available());
                    if available {
                        if icon_button(ui, "Open the report", icons::report).clicked() {
                            consumed = true;
                            ctx.push(AppCommand::Navigate(Route::ReportViewer {
                                context: ReportContext::BenchChildRun {
                                    bench_id: bench_id.clone(),
                                    bench_run_id: bench_run_id.clone(),
                                },
                                run_id: step.run_id.clone(),
                            }));
                        }
                    } else {
                        ui.label(text::none());
                    }
                });

                if !consumed && row.response().clicked() {
                    ctx.push(AppCommand::Navigate(Route::BenchChildRunDetail {
                        bench_id: bench_id.clone(),
                        bench_run_id: bench_run_id.clone(),
                        child_run_id: step.run_id.clone(),
                    }));
                }
            });
        });
}
