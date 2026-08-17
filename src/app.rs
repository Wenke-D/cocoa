//! Application root — coco, the real-backend experiment manager.
//!
//! The app drives the [`crate::coco::Coco`] engine directly. There is no mock
//! mode: registered folders are real, and every run is real script output.
//!
//! Frame shape:
//!
//! ```text
//! refresh the engine → render from immutable reads → collect commands
//! → execute commands → update route/overlay/theme → schedule repaint
//! ```

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::coco::{Coco, CocoError, Kind, RefreshReport, ReportMode, Status};
use crate::ui::coco::state::{CocoCommand, CocoOverlay, CocoRoute, CocoUiState};

/// Working title. The final product name is still undecided.
pub const APP_TITLE: &str = "coco — Experiment Pipeline Manager";

/// User theme choice. Mirrors [`egui::ThemePreference`] but is owned by this
/// crate so it can be persisted without enabling egui's `serde` feature.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

impl ThemePreference {
    pub const ALL: [Self; 3] = [Self::System, Self::Light, Self::Dark];

    pub fn label(self) -> &'static str {
        match self {
            Self::System => "System",
            Self::Light => "Light",
            Self::Dark => "Dark",
        }
    }

    pub fn apply(self, ctx: &egui::Context) {
        ctx.set_theme(match self {
            Self::System => egui::ThemePreference::System,
            Self::Light => egui::ThemePreference::Light,
            Self::Dark => egui::ThemePreference::Dark,
        });
    }

    pub fn next(self) -> Self {
        match self {
            Self::System => Self::Light,
            Self::Light => Self::Dark,
            Self::Dark => Self::System,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TransientMessage {
    pub text: String,
    pub is_error: bool,
}

/// The small set of preferences worth persisting across launches.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct CocoPrefs {
    pub theme: ThemePreference,
    pub sidebar_width: f32,
}

pub struct ExperimentApp {
    /// The engine. `None` only when the private store could not be loaded;
    /// the UI then shows an explanatory page.
    coco: Option<Coco>,
    pub ui: CocoUiState,
    prefs: CocoPrefs,
    /// A URL to hand to the system browser at the end of the frame.
    pending_url: Option<String>,
}

impl ExperimentApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let prefs: CocoPrefs = cc
            .storage
            .and_then(|storage| eframe::get_value(storage, eframe::APP_KEY))
            .unwrap_or_default();
        let sidebar_width = prefs
            .sidebar_width
            .clamp(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);

        crate::ui::theme::install(&cc.egui_ctx);
        prefs.theme.apply(&cc.egui_ctx);

        let coco = match Coco::new(default_store_path()) {
            Ok(coco) => Some(coco),
            Err(error) => {
                log::warn!("coco engine failed to start: {error}");
                None
            }
        };
        let ui = CocoUiState {
            theme: prefs.theme,
            sidebar_width,
            ..CocoUiState::default()
        };

        Self {
            coco,
            ui,
            prefs,
            pending_url: None,
        }
    }

    /// The URL queued for the system browser, if any. Exposed for tests.
    pub fn pending_url(&self) -> Option<&str> {
        self.pending_url.as_deref()
    }

    fn coco_frame(&mut self, ui: &mut egui::Ui) {
        if let Some(coco) = &mut self.coco {
            let due = self
                .ui
                .last_refresh
                .map(|at| at.elapsed() >= Duration::from_secs(3))
                .unwrap_or(true);
            if due && !coco.entities().is_empty() {
                let report = coco.refresh();
                self.apply_refresh_report(&report, false);
            }
        }

        let mut commands = Vec::new();
        {
            let coco = self.coco.as_ref();
            let state = &mut self.ui;
            match coco {
                Some(coco) => crate::ui::coco::show(ui, coco, state, &mut commands),
                None => {
                    egui::CentralPanel::default().show(ui, |ui| {
                        ui.label("The coco engine is not available.");
                        ui.label(
                            "The private store could not be loaded. Check the logs for the reason.",
                        );
                    });
                }
            }
        }

        for command in commands {
            self.execute_coco(command);
        }
        self.ui.theme.apply(ui.ctx());

        if let Some(url) = self.pending_url.take() {
            ui.ctx().open_url(egui::OpenUrl::new_tab(url));
        }

        self.recover_coco_route();
        ui.ctx().request_repaint_after(Duration::from_millis(500));
    }

    fn execute_coco(&mut self, command: CocoCommand) {
        let Some(coco) = &mut self.coco else {
            self.ui.notify_error("The coco engine is not available.");
            return;
        };

        match command {
            CocoCommand::Navigate(route) => self.ui.route = route,

            CocoCommand::Back => {
                if let Some(parent) = parent_route(&self.ui.route) {
                    self.ui.route = parent;
                }
            }

            CocoCommand::OpenRegister => {
                self.ui.overlay = CocoOverlay::RegisterFolder;
                self.ui.register_error = None;
            }

            CocoCommand::Register => {
                let path = self.ui.register_path.trim().to_owned();
                match coco.register(std::path::Path::new(&path)) {
                    Ok(()) => {
                        self.ui.overlay = CocoOverlay::None;
                        self.ui.register_error = None;
                        self.ui.notify(format!("Registered {path}."));
                        if let Ok(manifest) =
                            crate::coco::Manifest::load(std::path::Path::new(&path))
                        {
                            self.ui.route = match manifest.kind() {
                                Kind::Job => CocoRoute::JobOverview {
                                    path: std::path::PathBuf::from(&path),
                                },
                                Kind::Bench => CocoRoute::BenchOverview {
                                    path: std::path::PathBuf::from(&path),
                                },
                            };
                        }
                    }
                    Err(error) => self.ui.register_error = Some(error.to_string()),
                }
            }

            CocoCommand::AddMockLibrary => {
                let folders = bundled_mock_folders();
                if folders.is_empty() {
                    self.ui.notify_error(
                        "No bundled mock folders found — expected a `mock/` directory with coco.toml manifests.",
                    );
                    return;
                }
                let mut added = 0;
                let mut errors = Vec::new();
                for folder in folders {
                    match coco.register(&folder) {
                        Ok(()) => added += 1,
                        Err(CocoError::AlreadyRegistered(_)) => {}
                        Err(error) => errors.push(error.to_string()),
                    }
                }
                self.ui.route = CocoRoute::Library;
                if errors.is_empty() {
                    self.ui
                        .notify(format!("Added {added} bundled mock folder(s)."));
                } else {
                    self.ui.notify_error(format!(
                        "Added {added} folder(s); {} failed: {}",
                        errors.len(),
                        errors.join("; ")
                    ));
                }
            }

            CocoCommand::Unregister { path } => match coco.unregister(&path) {
                Ok(()) => {
                    self.ui
                        .notify(format!("Removed {} from the library.", path.display()));
                    if self.ui.route.entity_path() == Some(&path) {
                        self.ui.route = CocoRoute::Library;
                    }
                }
                Err(error) => self.ui.notify_error(error.to_string()),
            },

            CocoCommand::OpenStartJob { path } => {
                let fields = coco
                    .job_manifest(&path)
                    .map(|manifest| {
                        declared_params(&manifest.render_params, &manifest.launch_params)
                    })
                    .unwrap_or_default();
                self.ui.overlay = CocoOverlay::StartJob {
                    path,
                    fields,
                    submitting: false,
                    error: None,
                };
            }

            CocoCommand::FillLastArgs { path } => {
                if let CocoOverlay::StartJob { fields, .. } = &mut self.ui.overlay
                    && let Ok(manifest) = coco.job_manifest(&path)
                    && let Some(last) = coco.last_args().get(&manifest.name)
                {
                    for (name, value) in last {
                        if fields.contains_key(name) {
                            fields.insert(name.clone(), value.clone());
                        }
                    }
                }
            }

            CocoCommand::SubmitStartJob { path } => {
                let CocoOverlay::StartJob { fields, .. } = &mut self.ui.overlay else {
                    return;
                };
                let fields = fields.clone();
                let manifest = match coco.job_manifest(&path) {
                    Ok(manifest) => manifest,
                    Err(error) => {
                        self.ui.overlay = CocoOverlay::StartJob {
                            path: path.clone(),
                            fields,
                            submitting: false,
                            error: Some(error.to_string()),
                        };
                        return;
                    }
                };
                let render = split_fields(&fields, &manifest.render_params);
                let launch = split_fields(&fields, &manifest.launch_params);
                self.ui.overlay = CocoOverlay::StartJob {
                    path: path.clone(),
                    fields: fields.clone(),
                    submitting: true,
                    error: None,
                };
                match coco.start_job(&path, render, launch) {
                    Ok(run_id) => {
                        self.ui.overlay = CocoOverlay::None;
                        self.ui.notify(format!("Started run #{run_id}."));
                        self.ui.route = CocoRoute::JobRunDetail { path, run_id };
                    }
                    Err(error) => {
                        self.ui.overlay = CocoOverlay::StartJob {
                            path,
                            fields,
                            submitting: false,
                            error: Some(error.to_string()),
                        };
                    }
                }
            }

            CocoCommand::OpenStartBench { path } => {
                let fields = coco
                    .bench_manifest(&path)
                    .map(|manifest| declared_params(&manifest.plan_params, &[]))
                    .unwrap_or_default();
                self.ui.overlay = CocoOverlay::StartBench {
                    path,
                    fields,
                    plan: None,
                    submitting: false,
                    error: None,
                };
            }

            CocoCommand::PlanBench { path } => {
                let CocoOverlay::StartBench { fields, .. } = &mut self.ui.overlay else {
                    return;
                };
                let fields = fields.clone();
                match coco.plan_bench(&path, fields.clone()) {
                    Ok(instances) => {
                        self.ui.overlay = CocoOverlay::StartBench {
                            path: path.clone(),
                            fields,
                            plan: Some(instances),
                            submitting: false,
                            error: None,
                        };
                    }
                    Err(error) => {
                        self.ui.overlay = CocoOverlay::StartBench {
                            path: path.clone(),
                            fields,
                            plan: None,
                            submitting: false,
                            error: Some(error.to_string()),
                        };
                    }
                }
            }

            CocoCommand::DispatchBench { path } => {
                let CocoOverlay::StartBench { fields, .. } = &mut self.ui.overlay else {
                    return;
                };
                let fields = fields.clone();
                self.ui.overlay = CocoOverlay::StartBench {
                    path: path.clone(),
                    fields: fields.clone(),
                    plan: None,
                    submitting: true,
                    error: None,
                };
                match coco.start_bench(&path, fields.clone()) {
                    Ok(start) => {
                        self.ui.overlay = CocoOverlay::None;
                        self.ui.notify(format!(
                            "Bench run #{} dispatched {} member(s), {} launch failure(s).",
                            start.run_id,
                            start.members.len(),
                            start.launch_failures.len()
                        ));
                        self.ui.route = CocoRoute::BenchRunDetail {
                            path,
                            run_id: start.run_id,
                        };
                    }
                    Err(error) => {
                        self.ui.overlay = CocoOverlay::StartBench {
                            path,
                            fields,
                            plan: None,
                            submitting: false,
                            error: Some(error.to_string()),
                        };
                    }
                }
            }

            CocoCommand::CancelRun { path, run_id } => {
                self.ui.overlay = CocoOverlay::ConfirmCancelRun { path, run_id };
            }

            CocoCommand::ConfirmCancelRun { path, run_id } => {
                self.ui.overlay = CocoOverlay::None;
                match coco.cancel_run(&path, run_id) {
                    Ok(()) => self.ui.notify(format!("Run #{run_id} is cancelling.")),
                    Err(error) => self.ui.notify_error(error.to_string()),
                }
            }

            CocoCommand::CancelBench { path, run_id } => {
                self.ui.overlay = CocoOverlay::ConfirmCancelBench { path, run_id };
            }

            CocoCommand::ConfirmCancelBench { path, run_id } => {
                self.ui.overlay = CocoOverlay::None;
                match coco.cancel_bench(&path, run_id) {
                    Ok(results) => {
                        let cancelled = results.iter().filter(|r| r.ok).count();
                        let failed = results.len() - cancelled;
                        self.ui.notify(format!(
                            "Cancelling {cancelled} member(s){}.",
                            if failed > 0 {
                                format!("; {failed} failed")
                            } else {
                                String::new()
                            }
                        ));
                    }
                    Err(error) => self.ui.notify_error(error.to_string()),
                }
            }

            CocoCommand::ReportRun { path, run_id, mode } => {
                match coco.report_run(&path, run_id, mode) {
                    Ok(()) => self
                        .ui
                        .notify(format!("Report for run #{run_id} is ready.")),
                    Err(error) => self.ui.notify_error(error.to_string()),
                }
            }

            CocoCommand::OpenReport { path, run_id } => {
                self.ui.route = CocoRoute::ReportViewer { path, run_id };
            }

            CocoCommand::OpenHtmlReport { path, run_id } => {
                let html_path = path.join("report").join(format!("{run_id}.html"));
                match std::fs::read_to_string(&html_path) {
                    Ok(html) => {
                        let out = std::env::temp_dir().join(format!("coco-report-{run_id}.html"));
                        match std::fs::write(&out, html) {
                            Ok(()) => {
                                self.pending_url = Some(format!("file://{}", encode_path(&out)));
                                self.ui.notify("Opening the HTML report in your browser…");
                            }
                            Err(error) => self
                                .ui
                                .notify_error(format!("Could not write the report: {error}")),
                        }
                    }
                    Err(_) => {
                        self.ui
                            .notify_error("No HTML report is available for this run.");
                    }
                }
            }

            CocoCommand::PollEntity { path } => {
                let kind = coco.entities().into_iter().find_map(|view| {
                    (view.path == path)
                        .then_some(view.manifest)
                        .and_then(|result| result.ok().map(|manifest| manifest.kind()))
                });
                match kind {
                    Some(Kind::Job) => self.poll_job_entity(&path),
                    Some(Kind::Bench) => {
                        let report = coco.refresh();
                        self.apply_refresh_report(&report, true);
                    }
                    None => self.ui.notify_error("That folder is not registered."),
                }
            }

            CocoCommand::RefreshAll => {
                let report = coco.refresh();
                self.apply_refresh_report(&report, true);
            }

            CocoCommand::SetTheme(theme) => self.ui.theme = theme,

            CocoCommand::CloseOverlay => self.ui.overlay = CocoOverlay::None,

            CocoCommand::Notify(text) => self.ui.notify(text),
        }
    }

    fn poll_job_entity(&mut self, path: &std::path::Path) {
        let Some(coco) = &mut self.coco else {
            return;
        };
        match coco.poll_job(path) {
            Ok(report) => {
                self.ui.notify(format!(
                    "Polled: {} status change(s).",
                    report.changed.len()
                ));
            }
            Err(error) => self.ui.notify_error(error.to_string()),
        }
        let Ok(runs) = coco.job_runs(path) else {
            return;
        };
        let mut reported = 0;
        for view in runs {
            if let Ok(record) = &view.record
                && matches!(record.status, Status::Completed | Status::Analyzing)
            {
                reported += 1;
                if let Err(error) = coco.report_run(path, view.run_id, ReportMode::Auto) {
                    self.ui.notify_error(error.to_string());
                }
            }
        }
        if reported > 0 {
            self.ui.notify(format!("{reported} report(s) generated."));
        }
    }

    fn apply_refresh_report(&mut self, report: &RefreshReport, manual: bool) {
        let errors: Vec<String> = report
            .poll_errors
            .iter()
            .chain(&report.report_errors)
            .map(ToString::to_string)
            .collect();
        let changes = report.poll_changes.len() + report.reports_run;
        if manual {
            if errors.is_empty() {
                self.ui.notify(format!(
                    "Refreshed: {changes} status change(s), {} report(s).",
                    report.reports_run
                ));
            } else {
                self.ui.notify_error(summarize_errors(&errors));
            }
        } else if !errors.is_empty() && errors != self.ui.last_refresh_errors {
            self.ui.notify_error(summarize_errors(&errors));
        }
        self.ui.last_refresh_errors = errors;
        self.ui.last_refresh = Some(std::time::Instant::now());
    }

    fn recover_coco_route(&mut self) {
        let Some(coco) = &self.coco else {
            return;
        };
        let Some(path) = self.ui.route.entity_path() else {
            return;
        };
        if !coco.entities().iter().any(|view| &view.path == path) {
            self.ui.route = CocoRoute::Library;
        }
    }
}

impl eframe::App for ExperimentApp {
    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        self.prefs.theme = self.ui.theme;
        self.prefs.sidebar_width = self.ui.sidebar_width;
        eframe::set_value(storage, eframe::APP_KEY, &self.prefs);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.coco_frame(ui);
    }
}

pub const SIDEBAR_DEFAULT_WIDTH: f32 = 220.0;
pub const SIDEBAR_MIN_WIDTH: f32 = 180.0;
pub const SIDEBAR_MAX_WIDTH: f32 = 300.0;

/// Percent-encode the few characters that make a `file://` URL ambiguous.
fn encode_path(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|c| match c {
            ' ' => "%20".to_owned(),
            '#' => "%23".to_owned(),
            '?' => "%3F".to_owned(),
            other => other.to_string(),
        })
        .collect()
}

/// The engine's default private store location (convention §5), overridable
/// through `COCO_STORE_PATH` for development and tests.
fn default_store_path() -> std::path::PathBuf {
    if let Ok(store) = std::env::var("COCO_STORE_PATH") {
        return std::path::PathBuf::from(store);
    }
    if let Ok(home) = std::env::var("HOME") {
        return std::path::PathBuf::from(home).join(".local/share/coco/store.json");
    }
    std::path::PathBuf::from("coco-store.json")
}

/// An empty map with exactly the declared parameter names (§2: no defaults,
/// no prefill — the fields start empty).
fn declared_params(
    first: &[String],
    second: &[String],
) -> std::collections::BTreeMap<String, String> {
    first
        .iter()
        .chain(second)
        .map(|name| (name.clone(), String::new()))
        .collect()
}

/// The subset of the form's fields declared for one parameter set.
fn split_fields(
    fields: &std::collections::BTreeMap<String, String>,
    declared: &[String],
) -> std::collections::BTreeMap<String, String> {
    declared
        .iter()
        .filter_map(|name| fields.get(name).map(|value| (name.clone(), value.clone())))
        .collect()
}

fn parent_route(route: &CocoRoute) -> Option<CocoRoute> {
    match route {
        CocoRoute::Library => None,
        CocoRoute::JobOverview { .. } | CocoRoute::BenchOverview { .. } => Some(CocoRoute::Library),
        CocoRoute::JobRunDetail { path, .. } => Some(CocoRoute::JobOverview { path: path.clone() }),
        CocoRoute::BenchRunDetail { path, .. } => {
            Some(CocoRoute::BenchOverview { path: path.clone() })
        }
        CocoRoute::ReportViewer { .. } => Some(CocoRoute::Library),
    }
}

fn summarize_errors(errors: &[String]) -> String {
    match errors {
        [] => "No errors.".to_owned(),
        [only] => only.clone(),
        _ => format!("{} (and {} more)", errors[0], errors.len() - 1),
    }
}

/// Every folder under `mock/` that carries a `coco.toml` manifest, found by
/// a shallow recursive walk. These are the bundled mock experiments.
fn bundled_mock_folders() -> Vec<std::path::PathBuf> {
    let mut folders = Vec::new();
    let root = std::path::Path::new("mock");
    if root.is_dir() {
        collect_manifest_folders(root, &mut folders, 0);
    }
    folders
}

fn collect_manifest_folders(
    dir: &std::path::Path,
    out: &mut Vec<std::path::PathBuf>,
    depth: usize,
) {
    if depth > 3 {
        return;
    }
    if dir.join("coco.toml").is_file() {
        out.push(dir.to_owned());
        return;
    }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                collect_manifest_folders(&entry.path(), out, depth + 1);
            }
        }
    }
}
