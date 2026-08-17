//! Coco-mode main content: every route's page.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Local};

use crate::coco::{Coco, CocoError, EntityView, JobRunView, Kind, Manifest, ReportMode, RunRecord};
use crate::ui::coco::state::{CocoCommand, CocoRoute, CocoUiState};
use crate::ui::coco::status;
use crate::ui::space;
use crate::ui::theme;

pub fn show(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
) {
    let route = state.route.clone();
    match route {
        CocoRoute::Library => library(ui, coco, commands),
        CocoRoute::JobOverview { path } => job_overview(ui, coco, state, commands, &path),
        CocoRoute::BenchOverview { path } => bench_overview(ui, coco, state, commands, &path),
        CocoRoute::JobRunDetail { path, run_id } => {
            job_run_detail(ui, coco, commands, &path, run_id)
        }
        CocoRoute::BenchRunDetail { path, run_id } => {
            bench_run_detail(ui, coco, commands, &path, run_id)
        }
        CocoRoute::ReportViewer { path, run_id } => {
            report_viewer(ui, coco, state, commands, &path, run_id)
        }
    }
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

fn library(ui: &mut egui::Ui, coco: &Coco, commands: &mut Vec<CocoCommand>) {
    let palette = theme::of(ui);
    header(ui, "LIBRARY", "Registered experiment folders");
    ui.label(
        egui::RichText::new(format!("Store: {}", coco.store_path().display()))
            .small()
            .monospace()
            .color(palette.description),
    );
    ui.add_space(space::SECTION);

    let entities = coco.entities();
    if entities.is_empty() {
        ui.label("No folders registered yet.");
        ui.label("Register a folder containing a coco.toml manifest to begin (convention §1).");
        ui.add_space(space::NORMAL);
        ui.horizontal(|ui| {
            if ui.button("Register folder").clicked() {
                commands.push(CocoCommand::OpenRegister);
            }
            if ui
                .button("Add bundled mock library")
                .on_hover_text("Registers every folder under the repo's mock/ directory")
                .clicked()
            {
                commands.push(CocoCommand::AddMockLibrary);
            }
        });
        return;
    }

    ui.horizontal(|ui| {
        if ui
            .button("Add bundled mock library")
            .on_hover_text("Registers every folder under the repo's mock/ directory")
            .clicked()
        {
            commands.push(CocoCommand::AddMockLibrary);
        }
    });
    ui.add_space(space::SMALL);

    egui::Grid::new("coco_library_table")
        .striped(true)
        .spacing([space::NORMAL * 2.0, space::SMALL])
        .show(ui, |ui| {
            ui.label(egui::RichText::new("NAME").strong());
            ui.label(egui::RichText::new("KIND").strong());
            ui.label(egui::RichText::new("PATH").strong());
            ui.label(egui::RichText::new("MANIFEST").strong());
            ui.label("");
            ui.end_row();

            for view in entities {
                entity_row(ui, coco, commands, &view);
            }
        });
}

fn entity_row(ui: &mut egui::Ui, coco: &Coco, commands: &mut Vec<CocoCommand>, view: &EntityView) {
    let palette = theme::of(ui);
    match &view.manifest {
        Ok(manifest) => {
            ui.label(egui::RichText::new(manifest.name()).strong());
            ui.label(manifest.kind().label().to_uppercase());
            ui.label(
                egui::RichText::new(view.path.display().to_string())
                    .monospace()
                    .color(palette.description),
            );
            ui.label(egui::RichText::new("valid").color(palette.chart_green));
            if ui.button("Open").clicked() {
                commands.push(CocoCommand::Navigate(match manifest.kind() {
                    Kind::Job => CocoRoute::JobOverview {
                        path: view.path.clone(),
                    },
                    Kind::Bench => CocoRoute::BenchOverview {
                        path: view.path.clone(),
                    },
                }));
            }
            ui.end_row();
            let _ = coco;
        }
        Err(error) => {
            ui.label(egui::RichText::new(file_name(&view.path)).color(palette.error));
            ui.label("—");
            ui.label(
                egui::RichText::new(view.path.display().to_string())
                    .monospace()
                    .color(palette.description),
            );
            ui.label(egui::RichText::new("broken").color(palette.error))
                .on_hover_text(error.to_string());
            ui.button("Remove").clicked().then(|| {
                commands.push(CocoCommand::Unregister {
                    path: view.path.clone(),
                });
            });
            ui.end_row();
        }
    }
}

// ---------------------------------------------------------------------------
// Overviews
// ---------------------------------------------------------------------------

fn job_overview(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
    path: &Path,
) {
    breadcrumbs(
        ui,
        commands,
        vec![("Library".to_owned(), Some(CocoRoute::Library))],
    );
    match coco.job_manifest(path) {
        Ok(manifest) => {
            let palette = theme::of(ui);
            header(ui, "JOB", &manifest.name);
            ui.label(
                egui::RichText::new(path.display().to_string())
                    .monospace()
                    .color(palette.description),
            );
            if let Some(description) = &manifest.description {
                ui.label(description);
            }
            ui.add_space(space::NORMAL);
            ui.horizontal(|ui| {
                if ui
                    .button("Start Job")
                    .on_hover_text("Start a new run of this job")
                    .clicked()
                {
                    commands.push(CocoCommand::OpenStartJob {
                        path: path.to_owned(),
                    });
                }
                if ui.button("Poll now").clicked() {
                    commands.push(CocoCommand::PollEntity {
                        path: path.to_owned(),
                    });
                }
            });
            ui.add_space(space::SMALL);
            ui.label(
                egui::RichText::new(format!(
                    "template: {} · render params: {} · launch params: {}",
                    manifest.template.display(),
                    manifest.render_params.join(", "),
                    manifest.launch_params.join(", ")
                ))
                .small()
                .monospace()
                .color(palette.description),
            );
            ui.add_space(space::SECTION);
            section_heading(ui, "RUNS");
            let runs = match coco.job_runs(path) {
                Ok(runs) => runs,
                Err(error) => {
                    error_box(ui, &error.to_string());
                    return;
                }
            };
            if runs.is_empty() {
                ui.label("No runs yet.");
            } else {
                runs_table(ui, coco, state, commands, path, &runs);
            }
        }
        Err(error) => {
            breadcrumb_error(ui, commands, path);
            error_box(ui, &error.to_string());
        }
    }
}

fn runs_table(
    ui: &mut egui::Ui,
    _coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
    path: &Path,
    runs: &[JobRunView],
) {
    egui::ScrollArea::horizontal()
        .id_salt(("coco_job_runs", path))
        .show(ui, |ui| {
            egui::Grid::new(("coco_job_runs_grid", path))
                .striped(true)
                .spacing([space::NORMAL * 2.0, space::SMALL])
                .show(ui, |ui| {
                    for label in ["ID", "SUBMISSION", "STATUS", "STARTED", "REASON", ""] {
                        ui.label(egui::RichText::new(label).strong());
                    }
                    ui.end_row();

                    for view in runs {
                        match &view.record {
                            Ok(record) => {
                                run_row(ui, state, commands, path, view.run_id, record);
                            }
                            Err(error) => {
                                let palette = theme::of(ui);
                                ui.label(
                                    egui::RichText::new(view.run_id.to_string())
                                        .color(palette.error),
                                );
                                ui.label("—");
                                ui.label(egui::RichText::new("BROKEN").color(palette.error))
                                    .on_hover_text(error.to_string());
                                for _ in 0..3 {
                                    ui.label("");
                                }
                                ui.end_row();
                            }
                        }
                    }
                });
        });
}

fn run_row(
    ui: &mut egui::Ui,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
    path: &Path,
    run_id: u64,
    record: &RunRecord,
) {
    ui.label(egui::RichText::new(run_id.to_string()).monospace());
    ui.label(
        egui::RichText::new(&record.submission_id)
            .monospace()
            .weak(),
    );
    status::pill(ui, record.status);
    ui.label(fmt_time(record.started_at()));
    let reason = record.reason.clone().unwrap_or_default();
    ui.label(egui::RichText::new(truncate(&reason, 40)).weak())
        .on_hover_text(reason);

    ui.horizontal(|ui| {
        if ui.small_button("Open").clicked() {
            commands.push(CocoCommand::Navigate(CocoRoute::JobRunDetail {
                path: path.to_owned(),
                run_id,
            }));
        }
        if record.status.is_cancellable() && ui.small_button("Cancel").clicked() {
            commands.push(CocoCommand::CancelRun {
                path: path.to_owned(),
                run_id,
            });
        }
        if ui
            .small_button("Report")
            .on_hover_text("Re-run the report by hand")
            .clicked()
        {
            commands.push(CocoCommand::ReportRun {
                path: path.to_owned(),
                run_id,
                mode: ReportMode::Manual,
            });
        }
        if path.join("report").join(format!("{run_id}.txt")).is_file()
            && ui.small_button("View report").clicked()
        {
            commands.push(CocoCommand::OpenReport {
                path: path.to_owned(),
                run_id,
            });
        }
    });
    ui.end_row();
    let _ = state;
}

fn bench_overview(
    ui: &mut egui::Ui,
    coco: &Coco,
    _state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
    path: &Path,
) {
    breadcrumbs(
        ui,
        commands,
        vec![("Library".to_owned(), Some(CocoRoute::Library))],
    );
    match coco.bench_manifest(path) {
        Ok(manifest) => {
            let palette = theme::of(ui);
            header(ui, "BENCH", &manifest.name);
            ui.label(
                egui::RichText::new(path.display().to_string())
                    .monospace()
                    .color(palette.description),
            );
            if let Some(description) = &manifest.description {
                ui.label(description);
            }
            ui.add_space(space::NORMAL);
            ui.horizontal(|ui| {
                if ui.button("Start Bench").clicked() {
                    commands.push(CocoCommand::OpenStartBench {
                        path: path.to_owned(),
                    });
                }
                if ui.button("Poll now").clicked() {
                    commands.push(CocoCommand::PollEntity {
                        path: path.to_owned(),
                    });
                }
            });
            ui.add_space(space::SMALL);
            ui.label(
                egui::RichText::new(format!("plan params: {}", manifest.plan_params.join(", ")))
                    .small()
                    .monospace()
                    .color(palette.description),
            );
            ui.add_space(space::SECTION);
            section_heading(ui, "RUNS");
            let runs = match coco.bench_runs(path) {
                Ok(runs) => runs,
                Err(error) => {
                    error_box(ui, &error.to_string());
                    return;
                }
            };
            if runs.is_empty() {
                ui.label("No runs yet.");
            } else {
                egui::ScrollArea::horizontal()
                    .id_salt(("coco_bench_runs", path))
                    .show(ui, |ui| {
                        egui::Grid::new(("coco_bench_runs_grid", path))
                            .striped(true)
                            .spacing([space::NORMAL * 2.0, space::SMALL])
                            .show(ui, |ui| {
                                for label in ["ID", "STATUS", "PLANNED", "MEMBERS", "FAILED", ""] {
                                    ui.label(egui::RichText::new(label).strong());
                                }
                                ui.end_row();
                                for view in runs {
                                    match &view.record {
                                        Ok(record) => {
                                            let bench_status = coco.bench_status(path, view.run_id);
                                            ui.label(
                                                egui::RichText::new(view.run_id.to_string())
                                                    .monospace(),
                                            );
                                            match &bench_status {
                                                Ok(status) => {
                                                    status::pill(ui, status.status);
                                                    ui.label(status.succeeded.to_string());
                                                    ui.label(status.running.to_string());
                                                    ui.label(status.errors.to_string());
                                                }
                                                Err(error) => {
                                                    ui.label("ERROR")
                                                        .on_hover_text(error.to_string());
                                                    ui.label("");
                                                    ui.label("");
                                                    ui.label("");
                                                }
                                            }
                                            ui.horizontal(|ui| {
                                                if ui.small_button("Open").clicked() {
                                                    commands.push(CocoCommand::Navigate(
                                                        CocoRoute::BenchRunDetail {
                                                            path: path.to_owned(),
                                                            run_id: view.run_id,
                                                        },
                                                    ));
                                                }
                                                if ui.small_button("Cancel").clicked() {
                                                    commands.push(CocoCommand::CancelBench {
                                                        path: path.to_owned(),
                                                        run_id: view.run_id,
                                                    });
                                                }
                                                if ui.small_button("Report").clicked() {
                                                    commands.push(CocoCommand::ReportRun {
                                                        path: path.to_owned(),
                                                        run_id: view.run_id,
                                                        mode: ReportMode::Manual,
                                                    });
                                                }
                                            });
                                            ui.end_row();
                                            let _ = record;
                                        }
                                        Err(error) => {
                                            ui.label(view.run_id.to_string());
                                            ui.label("BROKEN").on_hover_text(error.to_string());
                                            for _ in 0..4 {
                                                ui.label("");
                                            }
                                            ui.end_row();
                                        }
                                    }
                                }
                            });
                    });
            }
        }
        Err(error) => {
            breadcrumb_error(ui, commands, path);
            error_box(ui, &error.to_string());
        }
    }
}

// ---------------------------------------------------------------------------
// Run details
// ---------------------------------------------------------------------------

fn job_run_detail(
    ui: &mut egui::Ui,
    coco: &Coco,
    commands: &mut Vec<CocoCommand>,
    path: &Path,
    run_id: u64,
) {
    let manifest = coco.job_manifest(path).ok();
    let label = manifest.as_ref().map(|m| m.name.clone());
    breadcrumbs(
        ui,
        commands,
        vec![
            ("Library".to_owned(), Some(CocoRoute::Library)),
            (
                label.as_deref().unwrap_or("job").to_owned(),
                Some(CocoRoute::JobOverview {
                    path: path.to_owned(),
                }),
            ),
        ],
    );
    match coco.run_record(path, run_id) {
        Ok(record) => {
            let palette = theme::of(ui);
            header(ui, "JOB RUN", &format!("#{run_id}"));
            ui.horizontal(|ui| {
                status::pill(ui, record.status);
                if record.status.is_cancellable() && ui.button("Cancel run").clicked() {
                    commands.push(CocoCommand::CancelRun {
                        path: path.to_owned(),
                        run_id,
                    });
                }
                if ui
                    .button("Run report")
                    .on_hover_text("Re-run the report script by hand")
                    .clicked()
                {
                    commands.push(CocoCommand::ReportRun {
                        path: path.to_owned(),
                        run_id,
                        mode: ReportMode::Manual,
                    });
                }
                if path.join("report").join(format!("{run_id}.txt")).is_file()
                    && ui.button("Open report").clicked()
                {
                    commands.push(CocoCommand::OpenReport {
                        path: path.to_owned(),
                        run_id,
                    });
                }
                if path.join("report").join(format!("{run_id}.html")).is_file()
                    && ui.button("Open HTML").clicked()
                {
                    commands.push(CocoCommand::OpenHtmlReport {
                        path: path.to_owned(),
                        run_id,
                    });
                }
            });
            ui.add_space(space::SECTION);

            key_value(ui, "Submission", &record.submission_id);
            key_value(ui, "Started", &fmt_time(record.started_at()));
            if let Some(ended) = record.ended_at() {
                key_value(ui, "Ended", &fmt_time(ended));
            }
            if let Some(reason) = &record.reason {
                key_value(ui, "Reason", reason);
            }
            if let Some(error) = &record.error {
                ui.add_space(space::NORMAL);
                ui.label(egui::RichText::new("ERROR OUTPUT").small().strong());
                mono_block(ui, error, palette);
            }
            if let Some(bench_name) = &record.bench_name {
                key_value(ui, "From bench", bench_name);
            }

            ui.add_space(space::SECTION);
            section_heading(ui, "PARAMETERS");
            if record.render.is_empty() && record.launch.is_empty() {
                ui.label("No parameters.");
            }
            for (name, value) in record.render.iter().chain(&record.launch) {
                key_value(ui, name, value);
            }

            ui.add_space(space::SECTION);
            section_heading(ui, "STATUS HISTORY");
            egui::Grid::new(("coco_history", run_id))
                .striped(true)
                .spacing([space::NORMAL * 2.0, space::SMALL])
                .show(ui, |ui| {
                    for change in &record.history {
                        status::pill(ui, change.status);
                        ui.label(fmt_time(change.at));
                        ui.end_row();
                    }
                });
        }
        Err(error) => {
            error_box(ui, &error.to_string());
        }
    }
}

fn bench_run_detail(
    ui: &mut egui::Ui,
    coco: &Coco,
    commands: &mut Vec<CocoCommand>,
    path: &Path,
    run_id: u64,
) {
    let manifest = coco.bench_manifest(path).ok();
    let label = manifest.as_ref().map(|m| m.name.clone());
    breadcrumbs(
        ui,
        commands,
        vec![
            ("Library".to_owned(), Some(CocoRoute::Library)),
            (
                label.as_deref().unwrap_or("bench").to_owned(),
                Some(CocoRoute::BenchOverview {
                    path: path.to_owned(),
                }),
            ),
        ],
    );
    match coco.bench_record(path, run_id) {
        Ok(record) => {
            let palette = theme::of(ui);
            header(ui, "BENCH RUN", &format!("#{run_id}"));
            let derived = coco.bench_status(path, run_id);
            match &derived {
                Ok(status) => {
                    ui.horizontal(|ui| {
                        status::pill(ui, status.status);
                        ui.label(format!(
                            "{} succeeded · {} running · {} failed · {} cancelled · {} errors",
                            status.succeeded,
                            status.running,
                            status.failed,
                            status.cancelled,
                            status.errors
                        ));
                        if ui.button("Cancel bench").clicked() {
                            commands.push(CocoCommand::CancelBench {
                                path: path.to_owned(),
                                run_id,
                            });
                        }
                        if ui.button("Run bench report").clicked() {
                            commands.push(CocoCommand::ReportRun {
                                path: path.to_owned(),
                                run_id,
                                mode: ReportMode::Manual,
                            });
                        }
                        if path.join("report").join(format!("{run_id}.txt")).is_file()
                            && ui.button("Open report").clicked()
                        {
                            commands.push(CocoCommand::OpenReport {
                                path: path.to_owned(),
                                run_id,
                            });
                        }
                    });
                    if !status.missing_members.is_empty() {
                        ui.add_space(space::NORMAL);
                        ui.label(
                            egui::RichText::new(format!(
                                "Cannot resolve member(s): {}",
                                status.missing_members.join(", ")
                            ))
                            .color(palette.error),
                        );
                    }
                }
                Err(error) => {
                    error_box(ui, &error.to_string());
                }
            }

            ui.add_space(space::SECTION);
            key_value(
                ui,
                "Planned",
                &format!("{} instance(s) planned", record.planned),
            );
            key_value(
                ui,
                "Dispatched",
                &format!("{} member(s)", record.members.len()),
            );
            key_value(ui, "Started", &fmt_time(record.started_at));

            if !record.launch_failures.is_empty() {
                ui.add_space(space::SECTION);
                section_heading(ui, "LAUNCH FAILURES");
                for failure in &record.launch_failures {
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new(format!(
                                "{} — {}",
                                failure.job,
                                failure.params_str()
                            ))
                            .monospace(),
                        );
                        ui.label(
                            egui::RichText::new(truncate(&failure.error, 60)).color(palette.error),
                        )
                        .on_hover_text(&failure.error);
                    });
                }
            }

            ui.add_space(space::SECTION);
            section_heading(ui, "MEMBERS");
            if record.members.is_empty() {
                ui.label("No members were dispatched.");
            } else {
                egui::ScrollArea::horizontal()
                    .id_salt(("coco_members", run_id))
                    .show(ui, |ui| {
                        egui::Grid::new(("coco_members_grid", run_id))
                            .striped(true)
                            .spacing([space::NORMAL * 2.0, space::SMALL])
                            .show(ui, |ui| {
                                for label in ["RUN", "JOB", "STATUS", "PARAMS", ""] {
                                    ui.label(egui::RichText::new(label).strong());
                                }
                                ui.end_row();
                                for member in &record.members {
                                    ui.label(
                                        egui::RichText::new(member.run_id.to_string()).monospace(),
                                    );
                                    ui.label(&member.job);
                                    let member_status = resolve_member_status(coco, member);
                                    match &member_status {
                                        Ok((job_path, record)) => {
                                            status::pill(ui, record.status);
                                            ui.label(
                                                egui::RichText::new(record.params_str())
                                                    .monospace()
                                                    .weak(),
                                            );
                                            if ui.small_button("Open").clicked() {
                                                commands.push(CocoCommand::Navigate(
                                                    CocoRoute::JobRunDetail {
                                                        path: job_path.clone(),
                                                        run_id: member.run_id,
                                                    },
                                                ));
                                            }
                                        }
                                        Err(error) => {
                                            ui.label(
                                                egui::RichText::new("MISSING").color(palette.error),
                                            )
                                            .on_hover_text(error.to_string());
                                            ui.label("");
                                            ui.label("");
                                        }
                                    }
                                    ui.end_row();
                                }
                            });
                    });
            }
        }
        Err(error) => {
            error_box(ui, &error.to_string());
        }
    }
}

fn resolve_member_status(
    coco: &Coco,
    member: &crate::coco::BenchMember,
) -> Result<(PathBuf, RunRecord), CocoError> {
    let job = coco
        .entities()
        .into_iter()
        .find_map(|view| match view.manifest {
            Ok(Manifest::Job(job)) if job.name == member.job => Some((view.path, job)),
            _ => None,
        })
        .ok_or_else(|| CocoError::not_found(format!("job `{}`", member.job)))?;
    let record = coco.run_record(&job.0, member.run_id)?;
    Ok((job.0, record))
}

// ---------------------------------------------------------------------------
// Report viewer
// ---------------------------------------------------------------------------

fn report_viewer(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
    path: &Path,
    run_id: u64,
) {
    breadcrumbs(
        ui,
        commands,
        vec![
            ("Library".to_owned(), Some(CocoRoute::Library)),
            (
                "run".to_owned(),
                Some(CocoRoute::JobRunDetail {
                    path: path.to_owned(),
                    run_id,
                }),
            ),
        ],
    );
    let palette = theme::of(ui);
    header(ui, "REPORT", &format!("#{run_id}"));
    ui.horizontal(|ui| {
        if ui
            .toggle_value(&mut state.report_wrap, "Wrap lines")
            .clicked()
        {
            ui.ctx().request_repaint();
        }
        if path.join("report").join(format!("{run_id}.html")).is_file()
            && ui.button("Open HTML in browser").clicked()
        {
            commands.push(CocoCommand::OpenHtmlReport {
                path: path.to_owned(),
                run_id,
            });
        }
    });
    ui.add_space(space::NORMAL);

    let report_path = path.join("report").join(format!("{run_id}.txt"));
    match std::fs::read_to_string(&report_path) {
        Ok(text) => {
            let mut text = text;
            let output = egui::TextEdit::multiline(&mut text)
                .font(egui::TextStyle::Monospace)
                .code_editor()
                .desired_rows(20)
                .desired_width(f32::INFINITY)
                .interactive(false);
            if state.report_wrap {
                ui.add(output);
            } else {
                egui::ScrollArea::horizontal().show(ui, |ui| {
                    ui.add(output);
                });
            }
        }
        Err(_) => {
            ui.label("No plain-text report is available for this run.");
            ui.label(
                egui::RichText::new("A report script that succeeded always produces report/<run_id>.txt (convention §7.3).")
                    .weak(),
            );
            if path.join("report").join(format!("{run_id}.html")).is_file() {
                ui.add_space(space::NORMAL);
                ui.label("An HTML report exists and is handed to the system browser.");
            }
        }
    }
    let _ = coco;
    let _ = palette;
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

fn header(ui: &mut egui::Ui, kind: &str, title: &str) {
    let palette = theme::of(ui);
    ui.label(
        egui::RichText::new(kind)
            .small()
            .strong()
            .color(palette.description),
    );
    ui.label(
        egui::RichText::new(title)
            .heading()
            .color(palette.strong_foreground),
    );
}

fn section_heading(ui: &mut egui::Ui, title: &str) {
    let palette = theme::of(ui);
    ui.label(
        egui::RichText::new(title)
            .small()
            .strong()
            .color(palette.description),
    );
    ui.add_space(space::SMALL);
}

fn key_value(ui: &mut egui::Ui, key: &str, value: &str) {
    let palette = theme::of(ui);
    egui::Grid::new(("coco_key_value", key))
        .num_columns(2)
        .spacing([space::NORMAL * 3.0, space::SMALL])
        .show(ui, |ui| {
            ui.label(
                egui::RichText::new(key)
                    .small()
                    .strong()
                    .color(palette.description),
            );
            ui.label(
                egui::RichText::new(value)
                    .monospace()
                    .color(palette.foreground),
            );
            ui.end_row();
        });
}

fn mono_block(ui: &mut egui::Ui, text: &str, palette: &crate::ui::theme::Palette) {
    egui::Frame::new()
        .fill(palette.code_bg)
        .stroke(egui::Stroke::new(1.0, palette.border))
        .corner_radius(3)
        .inner_margin(egui::Margin::symmetric(
            space::NORMAL as i8,
            space::NORMAL as i8,
        ))
        .show(ui, |ui| {
            egui::ScrollArea::horizontal().show(ui, |ui| {
                ui.label(egui::RichText::new(text).monospace());
            });
        });
}

fn error_box(ui: &mut egui::Ui, message: &str) {
    let palette = theme::of(ui);
    ui.add_space(space::NORMAL);
    egui::Frame::new()
        .fill(palette.error.gamma_multiply(0.10))
        .stroke(egui::Stroke::new(1.0, palette.error.gamma_multiply(0.5)))
        .corner_radius(3)
        .inner_margin(egui::Margin::symmetric(
            space::NORMAL as i8,
            space::NORMAL as i8,
        ))
        .show(ui, |ui| {
            ui.label(
                egui::RichText::new(message)
                    .color(palette.error)
                    .monospace(),
            );
        });
}

fn breadcrumbs(
    ui: &mut egui::Ui,
    commands: &mut Vec<CocoCommand>,
    crumbs: Vec<(String, Option<CocoRoute>)>,
) {
    let palette = theme::of(ui);
    ui.horizontal(|ui| {
        for (index, (label, route)) in crumbs.iter().enumerate() {
            if index > 0 {
                ui.label(egui::RichText::new("/").color(palette.description));
            }
            match route {
                Some(route) => {
                    let response = ui.link(label);
                    if response.clicked() {
                        commands.push(CocoCommand::Navigate(route.clone()));
                    }
                }
                None => {
                    ui.label(
                        egui::RichText::new(label)
                            .strong()
                            .color(palette.foreground),
                    );
                }
            }
        }
    });
    ui.add_space(space::NORMAL);
}

fn breadcrumb_error(ui: &mut egui::Ui, commands: &mut Vec<CocoCommand>, path: &Path) {
    breadcrumbs(
        ui,
        commands,
        vec![
            ("Library".to_owned(), Some(CocoRoute::Library)),
            (file_name(path), None),
        ],
    );
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn fmt_time(at: DateTime<Local>) -> String {
    at.format("%Y-%m-%d %H:%M:%S").to_string()
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_owned()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

trait ParamsDisplay {
    fn params_str(&self) -> String;
}

impl ParamsDisplay for crate::coco::LaunchFailure {
    fn params_str(&self) -> String {
        self.params
            .iter()
            .map(|(k, v)| format!("--{k} {v}"))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

impl ParamsDisplay for RunRecord {
    fn params_str(&self) -> String {
        self.all_params()
            .iter()
            .map(|(k, v)| format!("--{k} {v}"))
            .collect::<Vec<_>>()
            .join(" ")
    }
}
