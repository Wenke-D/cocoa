//! The shared body of a Job run's detail page.
//!
//! `JobRunDetail` and `BenchChildRunDetail` render **the same run record** and
//! must present identical facts (specification §19). They therefore share this
//! function; only breadcrumbs, Library selection, and the surrounding links
//! differ, and those live in the pages.

use crate::app::{AppCommand, ViewCtx};
use crate::backend::CancelTarget;
use crate::model::{JobRun, QueryHealth, ReportState, RunOrigin, format_duration, format_relative};
use crate::navigation::{ReportContext, Route};
use crate::ui::space;
use crate::ui::widgets::button::Button;
use crate::ui::widgets::{parameter_block, status_badge};

/// Page-specific trimmings around the shared facts.
pub struct Surround {
    /// Where a report opened from this page belongs in the breadcrumb trail.
    pub report_context: ReportContext,
    /// Extra rows appended to the overview fields, e.g. a Bench call index.
    pub extra_fields: Vec<(String, String)>,
    /// Show the `Source` row. Suppressed where the page already says it.
    pub show_source: bool,
}

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &JobRun, surround: &Surround) {
    header(ctx, ui, run, surround);
    ui.add_space(space::PAGE);

    overview_fields(ctx, ui, run, surround);
    ui.add_space(space::PAGE);

    section(ui, "PARAMETERS");
    // Never truncated on a detail page (specification §17.3).
    parameter_block::block(ui, &run.parameters);
    ui.add_space(space::PAGE);

    status_section(ctx, ui, run);
    ui.add_space(space::PAGE);

    report_section(ctx, ui, run, surround);
}

fn header(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &JobRun, surround: &Surround) {
    let name = ctx.snapshot.entity_name(&run.job_id).to_owned();

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.heading(&name);
            ui.label(
                egui::RichText::new(format!(
                    "Run {}",
                    run.started_at.format("%Y-%m-%d %H:%M:%S")
                ))
                .weak(),
            );
        });

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if run.status.is_cancellable() && Button::secondary("Cancel Run").show(ui).clicked() {
                ctx.push(AppCommand::RequestCancel(CancelTarget::JobRun(
                    run.id.clone(),
                )));
            }
            if run.report.is_available() && Button::secondary("Open Report").show(ui).clicked() {
                ctx.push(AppCommand::Navigate(Route::ReportViewer {
                    context: surround.report_context.clone(),
                    run_id: run.id.clone(),
                }));
            }
        });
    });

    ui.add_space(space::NORMAL);
    status_badge::pill(ui, run.display_status());
}

fn overview_fields(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &JobRun, surround: &Surround) {
    let now = ctx.now;
    section(ui, "OVERVIEW");

    egui::Grid::new("run_overview")
        .num_columns(2)
        .spacing([space::PAGE, space::NORMAL])
        .show(ui, |ui| {
            field(ui, "Run ID", |ui| {
                parameter_block::inline(ui, run.id.as_str())
            });

            field(ui, "Started", |ui| {
                ui.label(run.started_at.format("%Y-%m-%d %H:%M:%S").to_string());
            });

            // No end time for an active run (specification §17.2).
            if let Some(ended_at) = run.ended_at {
                field(ui, "Ended", |ui| {
                    ui.label(ended_at.format("%Y-%m-%d %H:%M:%S").to_string());
                });
            }

            field(ui, "Duration", |ui| {
                ui.label(format_duration(run.duration(now)));
            });

            field(ui, "Last successful query", |ui| {
                ui.label(format_relative(run.last_successful_query, now));
            });

            field(ui, "Query health", |ui| match &run.query_health {
                QueryHealth::Healthy => {
                    ui.label("Healthy");
                }
                QueryHealth::Delayed => {
                    ui.label("Delayed");
                }
                QueryHealth::Unavailable { message } => {
                    ui.label(
                        egui::RichText::new(format!("Unavailable — {message}"))
                            .color(ui.visuals().warn_fg_color),
                    );
                }
            });

            if surround.show_source {
                field(ui, "Source", |ui| source_value(ctx, ui, run));
            }

            for (label, value) in &surround.extra_fields {
                field(ui, label, |ui| {
                    ui.label(value);
                });
            }
        });
}

/// Where this run came from, linking back to the dispatching Bench run.
fn source_value(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &JobRun) {
    match &run.origin {
        RunOrigin::Direct => {
            ui.label("Started directly");
        }
        RunOrigin::BenchStep {
            bench_id,
            bench_run_id,
            step_index,
        } => {
            let bench_name = ctx.snapshot.entity_name(bench_id).to_owned();
            let started = ctx
                .snapshot
                .bench_run(bench_run_id)
                .map(|bench_run| bench_run.started_at.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| bench_run_id.to_string());

            ui.horizontal(|ui| {
                if ui
                    .link(format!("{bench_name} · Run {started} · call {step_index}"))
                    .clicked()
                {
                    ctx.push(AppCommand::Navigate(Route::BenchRunDetail {
                        bench_id: bench_id.clone(),
                        run_id: bench_run_id.clone(),
                    }));
                }
            });
        }
    }
}

/// The three presentations of §17.4, which must look distinct.
fn status_section(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &JobRun) {
    section(ui, "STATUS");

    match &run.query_health {
        // Query failure: never presented as an execution failure.
        QueryHealth::Unavailable { .. } => {
            notice(ui, ui.visuals().warn_fg_color, |ui| {
                ui.label(egui::RichText::new("Status unavailable").strong());
                ui.add_space(space::NORMAL);
                ui.label(format!("Last known status: {}", run.status.label()));
                ui.label(format!(
                    "Last successful query: {}.",
                    format_relative(run.last_successful_query, ctx.now)
                ));
                ui.add_space(space::NORMAL);
                ui.label("The application could not retrieve the current status.");
                ui.add_space(space::NORMAL);
                if Button::secondary("Retry Now").show(ui).clicked() {
                    ctx.push(AppCommand::RetryQuery(run.id.clone()));
                }
            });
        }

        _ if run.status == crate::model::RunStatus::Failed => {
            notice(ui, ui.visuals().error_fg_color, |ui| {
                ui.label(egui::RichText::new("Failed").strong());
                ui.add_space(space::NORMAL);
                ui.label(
                    run.error
                        .clone()
                        .unwrap_or_else(|| "The Job reported a failed execution state.".to_owned()),
                );
            });
        }

        _ => {
            ui.label(egui::RichText::new(run.status.label()).strong());
            ui.add_space(space::NORMAL);
            ui.label(status_badge::explanation(run.display_status()));
            if run.status.is_active() {
                ui.label(format!(
                    "Last successful query: {}.",
                    format_relative(run.last_successful_query, ctx.now)
                ));
            }
        }
    }
}

fn report_section(ctx: &mut ViewCtx, ui: &mut egui::Ui, run: &JobRun, surround: &Surround) {
    section(ui, "REPORT");

    match &run.report {
        ReportState::Available { .. } => {
            if Button::secondary("Open Report").show(ui).clicked() {
                ctx.push(AppCommand::Navigate(Route::ReportViewer {
                    context: surround.report_context.clone(),
                    run_id: run.id.clone(),
                }));
            }
        }
        ReportState::ReadError { message } => {
            notice(ui, ui.visuals().error_fg_color, |ui| {
                ui.label(egui::RichText::new("Unable to read report.").strong());
                ui.add_space(space::NORMAL);
                ui.label(message);
            });
        }
        other => {
            ui.label(egui::RichText::new(other.summary()).weak());
        }
    }
}

fn field(ui: &mut egui::Ui, label: &str, value: impl FnOnce(&mut egui::Ui)) {
    ui.label(egui::RichText::new(label).weak());
    value(ui);
    ui.end_row();
}

fn notice(ui: &mut egui::Ui, accent: egui::Color32, contents: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(accent.gamma_multiply(0.10))
        .stroke(egui::Stroke::new(1.0, accent.gamma_multiply(0.5)))
        .inner_margin(egui::Margin::same(11))
        .corner_radius(4)
        .show(ui, contents);
}

pub fn section(ui: &mut egui::Ui, title: &str) {
    ui.label(egui::RichText::new(title).small().strong().weak());
    ui.add_space(space::SMALL);
    ui.separator();
    ui.add_space(space::NORMAL);
}
