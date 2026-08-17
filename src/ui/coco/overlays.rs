//! Coco-mode modals: register, start job, start bench (with plan preview),
//! and the cancellation confirmations.

use std::path::PathBuf;

use crate::coco::{BenchManifest, Coco, JobManifest};
use crate::ui::coco::state::{CocoCommand, CocoOverlay, CocoUiState};
use crate::ui::space;
use crate::ui::theme;

/// Which overlay to render, with the data the page needs. The overlay itself
/// stays in `state`; the page mutates it directly while rendering.
enum Kind {
    Register,
    StartJob(PathBuf),
    StartBench(PathBuf),
    CancelRun { path: PathBuf, run_id: u64 },
    CancelBench { path: PathBuf, run_id: u64 },
}

pub fn show(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
) {
    let kind = match &state.overlay {
        CocoOverlay::None => return,
        CocoOverlay::RegisterFolder => Kind::Register,
        CocoOverlay::StartJob { path, .. } => Kind::StartJob(path.clone()),
        CocoOverlay::StartBench { path, .. } => Kind::StartBench(path.clone()),
        CocoOverlay::ConfirmCancelRun { path, run_id } => Kind::CancelRun {
            path: path.clone(),
            run_id: *run_id,
        },
        CocoOverlay::ConfirmCancelBench { path, run_id } => Kind::CancelBench {
            path: path.clone(),
            run_id: *run_id,
        },
    };

    match kind {
        Kind::Register => register(ui, state, commands),
        Kind::StartJob(path) => start_job(ui, coco, state, commands, &path),
        Kind::StartBench(path) => start_bench(ui, coco, state, commands, &path),
        Kind::CancelRun { path, run_id } => {
            confirm_cancel_run(ui, coco, commands, &path, run_id);
        }
        Kind::CancelBench { path, run_id } => {
            confirm_cancel_bench(ui, coco, commands, &path, run_id);
        }
    }
}

/// A modal whose body returns the commands it produced; a backdrop click or
/// Esc appends `CloseOverlay`.
fn modal(
    ui: &mut egui::Ui,
    title: &str,
    content: impl FnOnce(&mut egui::Ui) -> Vec<CocoCommand>,
) -> Vec<CocoCommand> {
    let response = egui::Modal::new("coco_modal".into()).show(ui.ctx(), |ui| {
        ui.set_width(440.0);
        ui.label(egui::RichText::new(title).heading());
        ui.add_space(space::NORMAL);
        content(ui)
    });
    let should_close = response.should_close();
    let mut commands = response.inner;
    if should_close {
        commands.push(CocoCommand::CloseOverlay);
    }
    commands
}

fn register(ui: &mut egui::Ui, state: &mut CocoUiState, commands: &mut Vec<CocoCommand>) {
    let palette = theme::of(ui);
    let actions = modal(ui, "Register folder", |ui| {
        let mut actions = Vec::new();
        ui.label("Path to an experiment folder containing coco.toml:");
        let response = ui.add(
            egui::TextEdit::singleline(&mut state.register_path)
                .font(egui::TextStyle::Monospace)
                .desired_width(f32::INFINITY),
        );
        if response.changed() {
            state.register_error = None;
        }
        if let Some(error) = &state.register_error {
            ui.label(egui::RichText::new(error.clone()).color(palette.error));
        }
        ui.add_space(space::NORMAL);
        ui.horizontal(|ui| {
            if ui.button("Cancel").clicked() {
                actions.push(CocoCommand::CloseOverlay);
            }
            if ui.button("Register").clicked() {
                actions.push(CocoCommand::Register);
            }
        });
        actions
    });
    commands.extend(actions);
}

fn start_job(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
    path: &std::path::Path,
) {
    let palette = theme::of(ui);
    let manifest = coco.job_manifest(path);
    let title = manifest
        .as_ref()
        .map(|m| format!("Start Job — {}", m.name))
        .unwrap_or_else(|_| "Start Job".to_owned());
    let actions = modal(ui, &title, |ui| {
        let mut actions = Vec::new();
        match &manifest {
            Ok(manifest) => {
                ui.label("Every declared parameter must be supplied by hand (convention §2).");
                ui.add_space(space::NORMAL);
                let CocoOverlay::StartJob {
                    fields,
                    submitting,
                    error,
                    ..
                } = &mut state.overlay
                else {
                    return actions;
                };
                param_fields(ui, manifest, fields);
                ui.add_space(space::NORMAL);
                if ui
                    .button("Fill from last run")
                    .on_hover_text("Fills the fields with the last start's values, nothing more")
                    .clicked()
                {
                    actions.push(CocoCommand::FillLastArgs {
                        path: path.to_owned(),
                    });
                }
                if let Some(error) = error {
                    ui.label(egui::RichText::new(error.clone()).color(palette.error));
                }
                ui.add_space(space::NORMAL);
                ui.horizontal(|ui| {
                    if ui.button("Cancel").clicked() {
                        actions.push(CocoCommand::CloseOverlay);
                    }
                    if ui
                        .add_enabled(!*submitting, egui::Button::new("Start Job"))
                        .clicked()
                    {
                        actions.push(CocoCommand::SubmitStartJob {
                            path: path.to_owned(),
                        });
                    }
                });
            }
            Err(err) => {
                ui.label(
                    egui::RichText::new(err.to_string())
                        .color(palette.error)
                        .monospace(),
                );
            }
        }
        actions
    });
    commands.extend(actions);
}

fn start_bench(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
    path: &std::path::Path,
) {
    let palette = theme::of(ui);
    let manifest = coco.bench_manifest(path);
    let title = manifest
        .as_ref()
        .map(|m| format!("Start Bench — {}", m.name))
        .unwrap_or_else(|_| "Start Bench".to_owned());
    let actions = modal(ui, &title, |ui| {
        let mut actions = Vec::new();
        match &manifest {
            Ok(manifest) => {
                ui.label("Plan parameters; the plan is produced and shown for confirmation before anything is dispatched (convention §8.1).");
                ui.add_space(space::NORMAL);
                let CocoOverlay::StartBench {
                    fields,
                    plan,
                    submitting,
                    error,
                    ..
                } = &mut state.overlay
                else {
                    return actions;
                };
                bench_param_fields(ui, manifest, fields);
                ui.add_space(space::NORMAL);
                if ui.button("Show plan").clicked() {
                    actions.push(CocoCommand::PlanBench {
                        path: path.to_owned(),
                    });
                }
                if let Some(plan) = plan {
                    ui.add_space(space::NORMAL);
                    ui.label(egui::RichText::new("PLAN").small().strong());
                    for instance in plan {
                        ui.label(
                            egui::RichText::new(format!(
                                "{} — {}",
                                instance.job_name,
                                instance
                                    .all_params()
                                    .iter()
                                    .map(|(k, v)| format!("--{k} {v}"))
                                    .collect::<Vec<_>>()
                                    .join(" ")
                            ))
                            .monospace(),
                        );
                    }
                }
                if let Some(error) = error {
                    ui.label(egui::RichText::new(error.clone()).color(palette.error));
                }
                ui.add_space(space::NORMAL);
                ui.horizontal(|ui| {
                    if ui.button("Cancel").clicked() {
                        actions.push(CocoCommand::CloseOverlay);
                    }
                    if ui
                        .add_enabled(!*submitting, egui::Button::new("Dispatch bench"))
                        .clicked()
                    {
                        actions.push(CocoCommand::DispatchBench {
                            path: path.to_owned(),
                        });
                    }
                });
            }
            Err(err) => {
                ui.label(
                    egui::RichText::new(err.to_string())
                        .color(palette.error)
                        .monospace(),
                );
            }
        }
        actions
    });
    commands.extend(actions);
}

fn param_fields(
    ui: &mut egui::Ui,
    manifest: &JobManifest,
    fields: &mut std::collections::BTreeMap<String, String>,
) {
    let names: Vec<&String> = manifest
        .render_params
        .iter()
        .chain(&manifest.launch_params)
        .collect();
    for name in names {
        let value = fields.entry(name.clone()).or_default();
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new(name.as_str()).monospace().strong());
            ui.add(
                egui::TextEdit::singleline(value)
                    .font(egui::TextStyle::Monospace)
                    .desired_width(f32::INFINITY),
            );
        });
    }
}

fn bench_param_fields(
    ui: &mut egui::Ui,
    manifest: &BenchManifest,
    fields: &mut std::collections::BTreeMap<String, String>,
) {
    for name in &manifest.plan_params {
        let value = fields.entry(name.clone()).or_default();
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new(name.as_str()).monospace().strong());
            ui.add(
                egui::TextEdit::singleline(value)
                    .font(egui::TextStyle::Monospace)
                    .desired_width(f32::INFINITY),
            );
        });
    }
}

fn confirm_cancel_run(
    ui: &mut egui::Ui,
    coco: &Coco,
    commands: &mut Vec<CocoCommand>,
    path: &std::path::Path,
    run_id: u64,
) {
    let record = coco.run_record(path, run_id);
    let title = format!("Cancel run #{run_id}?");
    let actions = modal(ui, &title, |ui| {
        let mut actions = Vec::new();
        match &record {
            Ok(record) => {
                ui.label(format!(
                    "{} — {}",
                    record.submission_id,
                    record.status.label()
                ));
            }
            Err(error) => {
                ui.label(error.to_string());
            }
        }
        ui.add_space(space::NORMAL);
        ui.horizontal(|ui| {
            if ui.button("Keep running").clicked() {
                actions.push(CocoCommand::CloseOverlay);
            }
            if ui.button("Cancel run").clicked() {
                actions.push(CocoCommand::ConfirmCancelRun {
                    path: path.to_owned(),
                    run_id,
                });
            }
        });
        actions
    });
    commands.extend(actions);
}

fn confirm_cancel_bench(
    ui: &mut egui::Ui,
    coco: &Coco,
    commands: &mut Vec<CocoCommand>,
    path: &std::path::Path,
    run_id: u64,
) {
    let record = coco.bench_record(path, run_id);
    let title = format!("Cancel bench run #{run_id}?");
    let actions = modal(ui, &title, |ui| {
        let mut actions = Vec::new();
        match &record {
            Ok(record) => {
                ui.label(format!(
                    "{} member(s) still active will be cancelled; finished members keep their results (convention §2.3.3).",
                    record.members.len()
                ));
            }
            Err(error) => {
                ui.label(error.to_string());
            }
        }
        ui.add_space(space::NORMAL);
        ui.horizontal(|ui| {
            if ui.button("Keep running").clicked() {
                actions.push(CocoCommand::CloseOverlay);
            }
            if ui.button("Cancel bench").clicked() {
                actions.push(CocoCommand::ConfirmCancelBench {
                    path: path.to_owned(),
                    run_id,
                });
            }
        });
        actions
    });
    commands.extend(actions);
}
