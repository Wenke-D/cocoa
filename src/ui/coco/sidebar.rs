//! Coco-mode sidebar: the registered Library, grouped by kind.

use std::path::Path;

use crate::coco::{Coco, Kind};
use crate::ui::coco::state::{CocoCommand, CocoRoute, CocoUiState};
use crate::ui::space;
use crate::ui::theme;

pub fn show(
    ui: &mut egui::Ui,
    coco: &Coco,
    state: &mut CocoUiState,
    commands: &mut Vec<CocoCommand>,
) {
    let palette = theme::of(ui);
    ui.add_space(space::NORMAL);
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("LIBRARY")
                .small()
                .strong()
                .color(palette.description),
        );
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            if ui
                .small_button("+")
                .on_hover_text("Register an experiment folder")
                .clicked()
            {
                commands.push(CocoCommand::OpenRegister);
            }
        });
    });
    ui.add_space(space::SMALL);

    let entities = coco.entities();
    let selected = state.route.entity_path().cloned();

    let mut jobs = Vec::new();
    let mut benches = Vec::new();
    let mut broken = Vec::new();
    for view in entities {
        match view.manifest {
            Ok(manifest) => match manifest.kind() {
                Kind::Job => jobs.push((view.path, manifest.name().to_owned())),
                Kind::Bench => benches.push((view.path, manifest.name().to_owned())),
            },
            Err(_) => broken.push(view),
        }
    }

    section(ui, "BENCHES", &benches, &selected, commands);
    section(ui, "JOBS", &jobs, &selected, commands);

    if !broken.is_empty() {
        ui.add_space(space::NORMAL);
        ui.label(
            egui::RichText::new("BROKEN MANIFESTS")
                .small()
                .strong()
                .color(palette.description),
        );
        for view in broken {
            let error = view
                .manifest
                .err()
                .map(|e| e.to_string())
                .unwrap_or_default();
            let row = egui::Frame::new()
                .inner_margin(egui::Margin::symmetric(
                    space::NORMAL as i8,
                    space::SMALL as i8,
                ))
                .fill(palette.row_hover)
                .show(ui, |ui| {
                    ui.horizontal(|ui| {
                        ui.label(egui::RichText::new("!").color(palette.error).strong());
                        ui.label(
                            egui::RichText::new(file_name(&view.path)).color(palette.foreground),
                        );
                    });
                });
            row.response
                .on_hover_text(format!("{}\n{}", view.path.display(), error))
                .context_menu(|ui| {
                    if ui.button("Remove from library").clicked() {
                        commands.push(CocoCommand::Unregister {
                            path: view.path.clone(),
                        });
                        ui.close();
                    }
                });
        }
    }

    ui.add_space(space::PAGE);
    ui.separator();
    ui.add_space(space::SMALL);
    ui.label(
        egui::RichText::new("REGISTERED FOLDERS")
            .small()
            .color(palette.description),
    );
    ui.label(
        egui::RichText::new(coco.store_path().display().to_string())
            .small()
            .monospace()
            .color(palette.description),
    );
}

fn section(
    ui: &mut egui::Ui,
    title: &str,
    items: &[(std::path::PathBuf, String)],
    selected: &Option<std::path::PathBuf>,
    commands: &mut Vec<CocoCommand>,
) {
    let palette = theme::of(ui);
    if items.is_empty() {
        return;
    }
    ui.label(
        egui::RichText::new(title)
            .small()
            .strong()
            .color(palette.description),
    );
    for (path, name) in items {
        let is_selected = selected.as_ref() == Some(path);
        let text = egui::RichText::new(name).color(if is_selected {
            palette.row_selected_fg
        } else {
            palette.foreground
        });
        let response = ui.selectable_label(is_selected, text);
        if response.clicked() {
            commands.push(CocoCommand::Navigate(overview(path)));
        }
        if response.hovered() {
            response.on_hover_text(path.display().to_string());
        }
    }
    ui.add_space(space::SMALL);
}

fn overview(path: &Path) -> CocoRoute {
    // Kind is resolved when the page renders; the route carries the path.
    // The manifest is re-read there, so this cannot mislabel a folder.
    match crate::coco::Manifest::load(path).map(|m| m.kind()) {
        Ok(crate::coco::Kind::Bench) => CocoRoute::BenchOverview {
            path: path.to_owned(),
        },
        _ => CocoRoute::JobOverview {
            path: path.to_owned(),
        },
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}
