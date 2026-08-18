//! Application root.
//!
//! Frame shape:
//!
//! ```text
//! tick the backend → take an immutable snapshot → render → collect commands
//! → execute commands → update route/overlay → schedule repaint
//! ```
//!
//! The UI is handed a snapshot and a command sink. It has no access to the
//! backend at all, so it cannot mutate domain state even by accident.

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

use crate::backend::{BackendSnapshot, CancelTarget, CocoBackend, ExperimentBackend};
use crate::coco::Coco;
use crate::navigation::{Overlay, Route, SubmitState};
use crate::view_model::{EntityId, ReportState, RunId, RunStatus};

/// Working title. The final product name is undecided.
pub const APP_TITLE: &str = "Experiment Pipeline Manager";

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
}

/// Which view the activity bar has open in the sidebar.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum SidebarView {
    #[default]
    Library,
    Running,
}

impl SidebarView {
    pub const ALL: [Self; 2] = [Self::Library, Self::Running];

    pub fn title(self) -> &'static str {
        match self {
            Self::Library => "Library",
            Self::Running => "Active Runs",
        }
    }

    pub fn tooltip(self) -> &'static str {
        match self {
            Self::Library => "Library",
            Self::Running => "Active runs",
        }
    }
}

/// Run-history status filter.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum StatusFilter {
    #[default]
    All,
    Active,
    Succeeded,
    Failed,
    Cancelled,
    Error,
}

impl StatusFilter {
    pub const ALL: [Self; 6] = [
        Self::All,
        Self::Active,
        Self::Succeeded,
        Self::Failed,
        Self::Cancelled,
        Self::Error,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::All => "All statuses",
            Self::Active => "Active",
            Self::Succeeded => "Succeeded",
            Self::Failed => "Failed",
            Self::Cancelled => "Cancelled",
            Self::Error => "Error",
        }
    }

    pub fn accepts(self, status: RunStatus) -> bool {
        match self {
            Self::All => true,
            Self::Active => status.is_active(),
            Self::Succeeded => status == RunStatus::Succeeded,
            Self::Failed => status == RunStatus::Failed,
            Self::Cancelled => status == RunStatus::Cancelled,
            Self::Error => status == RunStatus::Error,
        }
    }
}

pub const SIDEBAR_DEFAULT_WIDTH: f32 = 220.0;
pub const SIDEBAR_MIN_WIDTH: f32 = 180.0;
pub const SIDEBAR_MAX_WIDTH: f32 = 300.0;

#[derive(Clone, Debug)]
pub struct TransientMessage {
    pub text: String,
    pub is_error: bool,
}

/// Persistent UI preferences and transient view state.
#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct UiState {
    pub route: Route,
    pub theme: ThemePreference,
    pub sidebar_width: f32,
    pub sidebar_view: SidebarView,
    pub sidebar_open: bool,
    pub benches_section_open: bool,
    pub jobs_section_open: bool,
    pub status_filter: StatusFilter,

    #[serde(skip)]
    pub overlay: Overlay,
    #[serde(skip)]
    pub run_search: String,
    #[serde(skip)]
    pub transient_message: Option<TransientMessage>,
    #[serde(skip)]
    pub focus_parameter_field: bool,

    pub report_wrap_lines: bool,
    #[serde(skip)]
    pub report_search: String,
    #[serde(skip)]
    pub report_match_index: usize,
    #[serde(skip)]
    pub report_show_source: bool,
    #[serde(skip)]
    pub focus_report_search: bool,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            route: Route::default(),
            theme: ThemePreference::default(),
            sidebar_width: SIDEBAR_DEFAULT_WIDTH,
            sidebar_view: SidebarView::default(),
            sidebar_open: true,
            benches_section_open: true,
            jobs_section_open: true,
            status_filter: StatusFilter::default(),
            overlay: Overlay::None,
            run_search: String::new(),
            transient_message: None,
            focus_parameter_field: false,
            report_wrap_lines: false,
            report_search: String::new(),
            report_match_index: 0,
            report_show_source: false,
            focus_report_search: false,
        }
    }
}

impl UiState {
    fn sanitize(&mut self) {
        if !self.sidebar_width.is_finite() {
            self.sidebar_width = SIDEBAR_DEFAULT_WIDTH;
        }
        self.sidebar_width = self
            .sidebar_width
            .clamp(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
        if self.route.is_report() {
            self.route = Route::EmptyLibrary;
        }
    }

    pub fn notify(&mut self, text: impl Into<String>) {
        self.transient_message = Some(TransientMessage {
            text: text.into(),
            is_error: false,
        });
    }

    pub fn notify_error(&mut self, text: impl Into<String>) {
        self.transient_message = Some(TransientMessage {
            text: text.into(),
            is_error: true,
        });
    }
}

/// Everything the UI is allowed to ask for.
#[derive(Clone, Debug)]
pub enum AppCommand {
    SelectEntity(EntityId),
    Navigate(Route),
    NavigateBack,

    OpenStartModal(EntityId),
    FillLastArgs(EntityId),
    SubmitStart {
        entity_id: EntityId,
        parameters: BTreeMap<String, String>,
    },

    RequestCancel(CancelTarget),
    ConfirmCancel(CancelTarget),

    CloseOverlay,
    /// Opens the operating system's folder picker and registers what comes
    /// back (specification §11.5).
    AddFolder,
    Refresh,
    RetryQuery(RunId),
    OpenReportExternally(RunId),
    Notify(String),
}

/// Everything the UI needs for one frame, and nowhere to put anything else.
pub struct ViewCtx<'a> {
    pub state: &'a mut UiState,
    pub snapshot: &'a BackendSnapshot,
    pub now: DateTime<Local>,
    pub commands: &'a mut Vec<AppCommand>,
}

impl ViewCtx<'_> {
    pub fn push(&mut self, command: AppCommand) {
        self.commands.push(command);
    }
}

pub struct ExperimentApp {
    backend: Box<dyn ExperimentBackend>,
    pub ui: UiState,
    /// A submitted start, performed on the next frame so the `Starting…` state
    /// is rendered and slow backends can finish before the frame returns.
    pending_start: Option<(EntityId, BTreeMap<String, String>)>,
    /// A URL to hand to the system browser at the end of the frame.
    pending_url: Option<String>,
}

impl ExperimentApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let mut ui: UiState = cc
            .storage
            .and_then(|storage| eframe::get_value(storage, eframe::APP_KEY))
            .unwrap_or_default();
        ui.sanitize();
        crate::ui::theme::install(&cc.egui_ctx);
        ui.theme.apply(&cc.egui_ctx);

        let engine = Coco::new(default_store_path()).unwrap_or_else(|error| {
            log::warn!("coco engine failed to start at its default store: {error}");
            Coco::new(std::path::PathBuf::from("coco-store.json"))
                .expect("fallback store must load")
        });

        Self {
            backend: Box::new(CocoBackend::new(engine)),
            ui,
            pending_start: None,
            pending_url: None,
        }
    }

    /// Test seam: build an app around an arbitrary backend, without eframe.
    pub fn with_backend(backend: Box<dyn ExperimentBackend>) -> Self {
        Self {
            backend,
            ui: UiState::default(),
            pending_start: None,
            pending_url: None,
        }
    }

    pub fn poll(&mut self) {
        if let Some((entity_id, parameters)) = self.pending_start.take() {
            self.perform_start(entity_id, parameters);
        }
    }

    pub fn snapshot(&self) -> BackendSnapshot {
        self.backend.snapshot()
    }

    /// The URL queued for the system browser, if any. Exposed for tests.
    pub fn pending_url(&self) -> Option<&str> {
        self.pending_url.as_deref()
    }

    pub fn route(&self) -> &Route {
        &self.ui.route
    }

    pub fn recover_route(&mut self) {
        let snapshot = self.backend.snapshot();
        if let Some(recovery) = self.ui.route.recover(&snapshot) {
            self.ui.route = recovery.route;
            if let Some(message) = recovery.message {
                self.ui.notify(message);
            }
        }
    }

    pub fn execute(&mut self, command: AppCommand) {
        match command {
            AppCommand::SelectEntity(entity_id) => {
                self.ui.run_search.clear();
                self.ui.route = Route::EntityOverview { entity_id };
            }

            AppCommand::Navigate(route) => {
                if !route.is_report() {
                    self.ui.report_search.clear();
                    self.ui.report_match_index = 0;
                }
                self.ui.route = route;
            }

            AppCommand::NavigateBack => {
                if let Some(parent) = self.ui.route.parent() {
                    self.ui.route = parent;
                }
            }

            AppCommand::OpenStartModal(entity_id) => {
                let snapshot = self.backend.snapshot();
                let fields = snapshot
                    .entity(&entity_id)
                    .map(|entity| {
                        entity
                            .parameter_names
                            .iter()
                            .map(|name| (name.clone(), String::new()))
                            .collect()
                    })
                    .unwrap_or_default();
                self.ui.overlay = Overlay::StartRun {
                    entity_id,
                    fields,
                    submit_state: SubmitState::Idle,
                };
                self.ui.focus_parameter_field = true;
            }

            AppCommand::FillLastArgs(entity_id) => {
                if let Overlay::StartRun { fields, .. } = &mut self.ui.overlay {
                    let snapshot = self.backend.snapshot();
                    if let Some(entity) = snapshot.entity(&entity_id) {
                        for (name, value) in &entity.last_used {
                            if fields.contains_key(name) {
                                fields.insert(name.clone(), value.clone());
                            }
                        }
                    }
                }
            }

            AppCommand::SubmitStart {
                entity_id,
                parameters,
            } => {
                if let Overlay::StartRun { submit_state, .. } = &mut self.ui.overlay {
                    *submit_state = SubmitState::Submitting;
                }
                self.pending_start = Some((entity_id, parameters));
            }

            AppCommand::RequestCancel(target) => {
                self.ui.overlay = Overlay::ConfirmCancel {
                    target,
                    error: None,
                };
            }

            AppCommand::ConfirmCancel(target) => match self.backend.cancel(target) {
                Ok(()) => {
                    self.ui.overlay = Overlay::None;
                }
                Err(error) => {
                    let message = error.to_string();
                    if let Overlay::ConfirmCancel { error: slot, .. } = &mut self.ui.overlay {
                        *slot = Some(message.clone());
                    }
                    self.ui.notify_error(message);
                }
            },

            AppCommand::CloseOverlay => self.ui.overlay = Overlay::None,

            AppCommand::AddFolder => {
                if let Some(path) = pick_folder() {
                    self.add_folder(&path);
                }
            }

            AppCommand::RetryQuery(run_id) => {
                let _ = self.backend.refresh();
                let healthy = self
                    .backend
                    .snapshot()
                    .job_run(&run_id)
                    .is_none_or(|run| run.query_health.is_available());
                if healthy {
                    self.ui.notify("Query succeeded.");
                } else {
                    self.ui.notify_error("The status is still unavailable.");
                }
            }

            AppCommand::Refresh => match self.backend.refresh() {
                Ok(()) => self.ui.notify("Refreshed."),
                Err(error) => self.ui.notify_error(error.to_string()),
            },

            AppCommand::OpenReportExternally(run_id) => self.open_report_externally(&run_id),

            AppCommand::Notify(text) => self.ui.notify(text),
        }
    }

    /// Registers a folder the user chose and reports what happened.
    ///
    /// Separate from the picker so the whole outcome — messages, navigation —
    /// is exercisable without a dialog.
    pub fn add_folder(&mut self, path: &std::path::Path) {
        let before: Vec<EntityId> = self
            .backend
            .snapshot()
            .entities
            .iter()
            .map(|entity| entity.id.clone())
            .collect();

        let outcome = match self.backend.register_folder(path) {
            Ok(outcome) => outcome,
            Err(error) => {
                self.ui.notify_error(error.to_string());
                return;
            }
        };

        // Land on the first folder this action added, so the user sees the
        // result of the pick rather than wherever they already were.
        if let Some(entity) = self
            .backend
            .snapshot()
            .entities
            .iter()
            .find(|entity| !before.contains(&entity.id))
        {
            self.ui.route = Route::EntityOverview {
                entity_id: entity.id.clone(),
            };
        }

        let mut parts = Vec::new();
        match outcome.added.len() {
            0 => {}
            1 => parts.push(format!("Added {}.", outcome.added[0])),
            count => parts.push(format!("Added {count} folders.")),
        }
        if outcome.already_registered > 0 {
            parts.push(format!(
                "{} already in the library.",
                outcome.already_registered
            ));
        }
        parts.extend(outcome.refused.iter().cloned());

        let failed = outcome.added.is_empty() && !outcome.refused.is_empty();
        let message = if parts.is_empty() {
            "Nothing to add.".to_owned()
        } else {
            parts.join(" ")
        };
        if failed {
            self.ui.notify_error(message);
        } else {
            self.ui.notify(message);
        }
    }

    fn perform_start(&mut self, entity_id: EntityId, parameters: BTreeMap<String, String>) {
        let kind = self
            .backend
            .snapshot()
            .entity(&entity_id)
            .map(|entity| entity.kind);

        match self.backend.start(&entity_id, parameters) {
            Ok(run_id) => {
                self.ui.overlay = Overlay::None;
                self.ui.route = match kind {
                    Some(crate::view_model::EntityKind::Bench) => Route::BenchRunDetail {
                        bench_id: entity_id,
                        run_id,
                    },
                    _ => Route::JobRunDetail {
                        job_id: entity_id,
                        run_id,
                    },
                };
            }
            Err(error) => {
                if let Overlay::StartRun { submit_state, .. } = &mut self.ui.overlay {
                    *submit_state = SubmitState::Failed(error.to_string());
                }
            }
        }
    }

    fn open_report_externally(&mut self, run_id: &RunId) {
        let state = match self.backend.report(run_id) {
            Ok(state) => state,
            Err(error) => {
                self.ui.notify_error(error.to_string());
                return;
            }
        };

        let ReportState::Available { format, text } = state else {
            self.ui.notify_error("That report is not available.");
            return;
        };

        let path = std::env::temp_dir().join(format!(
            "experiment-report-{run_id}.{}",
            format.file_extension()
        ));

        match std::fs::write(&path, text.as_bytes()) {
            Ok(()) => {
                self.pending_url = Some(format!("file://{}", encode_path(&path)));
                self.ui.notify("Opening the report in your browser…");
            }
            Err(error) => self
                .ui
                .notify_error(format!("Could not write the report: {error}")),
        }
    }

    fn schedule_repaint(&self, ctx: &egui::Context) {
        let snapshot = self.backend.snapshot();
        let needs_animation = snapshot.active_run_count() > 0 || self.ui.overlay.is_open();
        if needs_animation {
            ctx.request_repaint_after(Duration::from_millis(500));
        }
    }
}

impl eframe::App for ExperimentApp {
    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        eframe::set_value(storage, eframe::APP_KEY, &self.ui);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let now = Local::now();
        self.poll();
        self.backend.tick(now);
        self.recover_route();

        let snapshot = self.backend.snapshot();
        let mut commands = Vec::new();

        {
            let mut ctx = ViewCtx {
                state: &mut self.ui,
                snapshot: &snapshot,
                now,
                commands: &mut commands,
            };
            crate::ui::shell::show(&mut ctx, ui);
        }

        for command in commands {
            self.execute(command);
        }

        if let Some(url) = self.pending_url.take() {
            ui.ctx().open_url(egui::OpenUrl::new_tab(url));
        }

        self.recover_route();
        self.schedule_repaint(ui.ctx());
    }
}

/// The operating system's own folder picker (specification §11.5).
///
/// Blocking and native: the user browses with the file manager they already
/// know, so no path is ever typed by hand. `None` means they cancelled.
fn pick_folder() -> Option<std::path::PathBuf> {
    let mut dialog = rfd::FileDialog::new().set_title("Add Experiment Folder");
    if let Ok(cwd) = std::env::current_dir() {
        dialog = dialog.set_directory(cwd);
    }
    dialog.pick_folder()
}

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
pub fn default_store_path() -> std::path::PathBuf {
    if let Ok(store) = std::env::var("COCO_STORE_PATH") {
        return std::path::PathBuf::from(store);
    }
    if let Ok(home) = std::env::var("HOME") {
        return std::path::PathBuf::from(home).join(".local/share/coco/store.json");
    }
    std::path::PathBuf::from("coco-store.json")
}
