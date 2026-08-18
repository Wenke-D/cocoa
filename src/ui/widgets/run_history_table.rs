//! Run-history tables (specification §22).
//!
//! Fixed header, scrolling body, newest first, whole row clickable, stable
//! column widths so that a ticking duration never shifts the layout.

use egui_extras::{Column, TableBuilder};

use crate::app::{AppCommand, ViewCtx};
use crate::model::{BenchRun, JobRun, RunOrigin, format_duration};
use crate::navigation::{ReportContext, Route};
use crate::ui::icons;
use crate::ui::widgets::button::Button;
use crate::ui::widgets::{icon_button, parameter_block, rows_are_clickable, status_badge};
use crate::ui::{space, text};

const ROW_HEIGHT: f32 = 24.0;
const HEADER_HEIGHT: f32 = 22.0;

/// A Job's complete history, including runs a Bench dispatched.
pub fn job_history(ctx: &mut ViewCtx, ui: &mut egui::Ui, runs: &[&JobRun]) {
    let now = ctx.now;
    let snapshot = ctx.snapshot;

    rows_are_clickable(ui);

    TableBuilder::new(ui)
        .id_salt("job_history")
        .striped(true)
        .sense(egui::Sense::click())
        .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
        .column(Column::initial(150.0).at_least(120.0)) // Started
        .column(Column::remainder().at_least(160.0).clip(true)) // Parameters
        .column(Column::initial(150.0).at_least(90.0).clip(true)) // Source
        .column(Column::exact(110.0)) // Status
        .column(Column::exact(80.0)) // Duration
        .column(Column::exact(70.0)) // Report
        .min_scrolled_height(0.0)
        .header(HEADER_HEIGHT, |mut header| {
            for title in [
                "Started",
                "Parameters",
                "Source",
                "Status",
                "Duration",
                "Report",
            ] {
                header.col(|ui| {
                    ui.label(text::table_header(title));
                });
            }
        })
        .body(|body| {
            body.rows(ROW_HEIGHT, runs.len(), |mut row| {
                let run = runs[row.index()];
                let mut consumed = false;

                row.col(|ui| {
                    ui.label(run.started_at.format("%Y-%m-%d %H:%M:%S").to_string());
                });
                row.col(|ui| parameter_block::truncated_cell(ui, &run.parameters));

                // Where this run came from (specification §13.3).
                row.col(|ui| match &run.origin {
                    RunOrigin::Direct => {
                        ui.label(text::none());
                    }
                    RunOrigin::BenchStep {
                        bench_id,
                        bench_run_id,
                        ..
                    } => {
                        let name = snapshot.entity_name(bench_id);
                        if ui.link(name).on_hover_text("Open the Bench run").clicked() {
                            consumed = true;
                            ctx.push(AppCommand::Navigate(Route::BenchRunDetail {
                                bench_id: bench_id.clone(),
                                run_id: bench_run_id.clone(),
                            }));
                        }
                    }
                });

                row.col(|ui| {
                    status_badge::badge(ui, run.display_status());
                });
                row.col(|ui| {
                    ui.label(format_duration(run.duration(now)));
                });
                row.col(|ui| {
                    if run.report.is_available() {
                        if icon_button(ui, "Open the report", icons::report).clicked() {
                            // Opening the report must not also trigger the row
                            // navigation (specification §13.3).
                            consumed = true;
                            ctx.push(AppCommand::Navigate(Route::ReportViewer {
                                context: ReportContext::JobRun {
                                    job_id: run.job_id.clone(),
                                },
                                run_id: run.id.clone(),
                            }));
                        }
                    } else {
                        ui.label(text::none());
                    }
                });

                if !consumed && row.response().clicked() {
                    ctx.push(AppCommand::Navigate(Route::JobRunDetail {
                        job_id: run.job_id.clone(),
                        run_id: run.id.clone(),
                    }));
                }
            });
        });
}

/// A Bench's run history.
pub fn bench_history(ctx: &mut ViewCtx, ui: &mut egui::Ui, runs: &[&BenchRun]) {
    let now = ctx.now;
    let snapshot = ctx.snapshot;

    rows_are_clickable(ui);

    TableBuilder::new(ui)
        .id_salt("bench_history")
        .striped(true)
        .sense(egui::Sense::click())
        .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
        .column(Column::initial(150.0).at_least(120.0)) // Started
        .column(Column::remainder().at_least(140.0).clip(true)) // Parameters
        .column(Column::exact(90.0)) // Dispatched
        .column(Column::exact(70.0)) // Progress
        .column(Column::exact(110.0)) // Status
        .column(Column::exact(80.0)) // Duration
        .column(Column::exact(70.0)) // Report
        .min_scrolled_height(0.0)
        .header(HEADER_HEIGHT, |mut header| {
            for title in [
                "Started",
                "Parameters",
                "Dispatched",
                "Progress",
                "Status",
                "Duration",
                "Report",
            ] {
                header.col(|ui| {
                    ui.label(text::table_header(title));
                });
            }
        })
        .body(|body| {
            body.rows(ROW_HEIGHT, runs.len(), |mut row| {
                let run = runs[row.index()];
                let progress = snapshot.bench_progress(run);
                let mut consumed = false;

                row.col(|ui| {
                    ui.label(run.started_at.format("%Y-%m-%d %H:%M:%S").to_string());
                });
                row.col(|ui| parameter_block::truncated_cell(ui, &run.parameters));
                row.col(|ui| {
                    ui.label(progress.total.to_string());
                });
                row.col(|ui| {
                    // An exact run count, never a bare percentage
                    // (specification §14.3).
                    ui.label(format!("{} / {}", progress.finished(), progress.total));
                });
                row.col(|ui| {
                    status_badge::badge(ui, run.display_status());
                });
                row.col(|ui| {
                    ui.label(format_duration(run.duration(now)));
                });
                row.col(|ui| {
                    if run.report.is_available() {
                        if icon_button(ui, "Open the report", icons::report).clicked() {
                            consumed = true;
                            ctx.push(AppCommand::Navigate(Route::ReportViewer {
                                context: ReportContext::BenchRun {
                                    bench_id: run.bench_id.clone(),
                                },
                                run_id: run.id.clone(),
                            }));
                        }
                    } else {
                        ui.label(text::none());
                    }
                });

                if !consumed && row.response().clicked() {
                    ctx.push(AppCommand::Navigate(Route::BenchRunDetail {
                        bench_id: run.bench_id.clone(),
                        run_id: run.id.clone(),
                    }));
                }
            });
        });
}

/// Status filter, parameter search, and manual Refresh (specification §13.3).
///
/// These affect All Runs only, never the Active Runs section.
pub fn filter_controls(ctx: &mut ViewCtx, ui: &mut egui::Ui, shown: usize, total: usize) {
    ui.horizontal(|ui| {
        let mut filter = ctx.state.status_filter;
        egui::ComboBox::from_id_salt("status_filter")
            .selected_text(filter.label())
            .show_ui(ui, |ui| {
                for option in crate::app::StatusFilter::ALL {
                    ui.selectable_value(&mut filter, option, option.label());
                }
            });
        ctx.state.status_filter = filter;

        ui.add_space(space::NORMAL);
        ui.add(
            egui::TextEdit::singleline(&mut ctx.state.run_search)
                .hint_text("Search parameters")
                .desired_width(220.0),
        );

        ui.add_space(space::NORMAL);
        if Button::secondary("Refresh").show(ui).clicked() {
            ctx.push(AppCommand::Refresh);
        }

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            let noun = if total == 1 { "run" } else { "runs" };
            let text = if shown == total {
                format!("{total} {noun}")
            } else {
                format!("{shown} of {total} {noun}")
            };
            ui.label(text::caption(text));
        });
    });
}
