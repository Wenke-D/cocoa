//! The shared body of a Job run's detail page.
//!
//! `JobRunDetail` and `BenchChildRunDetail` render **the same run record** and
//! must present identical facts (specification §19). They therefore share this
//! function; only breadcrumbs, Library selection, and the surrounding links
//! differ, and those live in the pages.

use crate::adapter::CancelTarget;
use crate::app::{AppCommand, ViewCtx};
use crate::navigation::{ReportContext, Route};
use crate::ui::widgets::button::Button;
use crate::ui::widgets::section::Section;
use crate::ui::widgets::{form, parameter_block, status_badge, surface};
use crate::ui::{space, text, theme};
use crate::view_model::{
    JobRun, QueryHealth, ReportState, RunOrigin, format_duration, format_relative,
};

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

    Section::new("PARAMETERS").show_heading(ui);
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
            ui.label(text::title(&name));
            ui.label(text::muted(format!(
                "Run {}",
                run.started_at.format("%Y-%m-%d %H:%M:%S")
            )));
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
    Section::new("OVERVIEW").show_heading(ui);

    form::grid(ui, "run_overview", |form| {
        form.row("Run ID", |ui| parameter_block::inline(ui, run.id.as_str()));

        form.row("Started", |ui| {
            ui.label(run.started_at.format("%Y-%m-%d %H:%M:%S").to_string());
        });

        // No end time for an active run (specification §17.2).
        if let Some(ended_at) = run.ended_at {
            form.row("Ended", |ui| {
                ui.label(ended_at.format("%Y-%m-%d %H:%M:%S").to_string());
            });
        }

        form.row("Duration", |ui| {
            ui.label(format_duration(run.duration(now)));
        });

        form.row("Last successful query", |ui| {
            ui.label(format_relative(run.last_successful_query, now));
        });

        form.row("Query health", |ui| match &run.query_health {
            QueryHealth::Healthy => {
                ui.label("Healthy");
            }
            QueryHealth::Delayed => {
                ui.label("Delayed");
            }
            QueryHealth::Unavailable { message } => {
                ui.label(text::warning(ui, format!("Unavailable — {message}")));
            }
        });

        if surround.show_source {
            form.row("Source", |ui| source_value(ctx, ui, run));
        }

        for (label, value) in &surround.extra_fields {
            form.row(label, |ui| {
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
    Section::new("STATUS").show_heading(ui);

    match &run.query_health {
        // Query failure: never presented as an execution failure.
        QueryHealth::Unavailable { .. } => {
            surface::callout(ui, theme::Level::Warning, |ui| {
                ui.label(text::strong("Status unavailable"));
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

        _ if run.status == crate::view_model::RunStatus::Failed => {
            surface::callout(ui, theme::Level::Error, |ui| {
                ui.label(text::strong("Failed"));
                ui.add_space(space::NORMAL);
                ui.label(
                    run.error
                        .clone()
                        .unwrap_or_else(|| "The Job reported a failed execution state.".to_owned()),
                );
            });
        }

        _ => {
            ui.label(text::strong(run.status.label()));
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
    Section::new("REPORT").show_heading(ui);

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
            surface::callout(ui, theme::Level::Error, |ui| {
                ui.label(text::strong("Unable to read report."));
                ui.add_space(space::NORMAL);
                ui.label(message);
            });
        }
        other => {
            ui.label(text::muted(other.summary()));
        }
    }
}
