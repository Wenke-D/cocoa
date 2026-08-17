//! Application root.
//!
//! Frame shape (specification §26.2):
//!
//! ```text
//! tick the backend → take an immutable snapshot → render → collect commands
//! → execute commands → update route/overlay → schedule repaint
//! ```
//!
//! The UI is handed a snapshot and a command sink. It has no access to the
//! backend at all, so it cannot mutate domain state even by accident.

use std::time::Duration;

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

use crate::backend::{
    BackendSnapshot, CancelTarget, DemoEntityKind, MockBackend, PrototypeBackend,
};
use crate::coco::{Coco, Kind, RefreshReport, ReportMode, Status};
use crate::model::{EntityId, ReportState, RunId, RunStatus};
use crate::navigation::{Overlay, Route, SubmitState};
use crate::ui::coco::state::{CocoCommand, CocoOverlay, CocoRoute, CocoUiState};

/// Working title. The final product name is undecided.
pub const APP_TITLE: &str = "Experiment Pipeline Manager";

/// Which backend the app is driving: the deterministic mock prototype or the
/// real coco engine over experiment folders.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppMode {
    #[default]
    Prototype,
    Coco,
}

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
///
/// The workbench keeps one sidebar and swaps its contents, exactly as VS Code
/// does — this is still the single left region of §7.2, never a second column.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum SidebarView {
    #[default]
    Library,
    Running,
}

impl SidebarView {
    pub const ALL: [Self; 2] = [Self::Library, Self::Running];

    /// The uppercase heading shown at the top of the sidebar.
    pub fn title(self) -> &'static str {
        match self {
            Self::Library => "Library",
            Self::Running => "Active Runs",
        }
    }

    /// Tooltip text for the activity bar button.
    pub fn tooltip(self) -> &'static str {
        match self {
            Self::Library => "Library",
            Self::Running => "Active runs",
        }
    }
}

/// Run-history status filter (specification §22.4).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum StatusFilter {
    #[default]
    All,
    Active,
    Succeeded,
    Failed,
    Cancelled,
}

impl StatusFilter {
    pub const ALL: [Self; 5] = [
        Self::All,
        Self::Active,
        Self::Succeeded,
        Self::Failed,
        Self::Cancelled,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Self::All => "All statuses",
            Self::Active => "Active",
            Self::Succeeded => "Succeeded",
            Self::Failed => "Failed",
            Self::Cancelled => "Cancelled",
        }
    }

    pub fn accepts(self, status: RunStatus) -> bool {
        match self {
            Self::All => true,
            Self::Active => status.is_active(),
            Self::Succeeded => status == RunStatus::Succeeded,
            Self::Failed => status == RunStatus::Failed,
            Self::Cancelled => status == RunStatus::Cancelled,
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
///
/// Nothing here is domain state. Run status, reports, and query health belong to
/// the backend and are never stored or mutated by the UI.
#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct UiState {
    pub route: Route,
    pub mode: AppMode,
    pub theme: ThemePreference,
    pub sidebar_width: f32,
    pub sidebar_view: SidebarView,
    /// Clicking the open activity bar item collapses the sidebar, as in VS Code.
    pub sidebar_open: bool,
    /// Collapsed state of the two Library sections.
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

    /// Report viewer state. Wrapping is a preference worth keeping; the search
    /// term is not.
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
            mode: AppMode::default(),
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
    /// Clamp values that could have been persisted from an older build.
    fn sanitize(&mut self) {
        if !self.sidebar_width.is_finite() {
            self.sidebar_width = SIDEBAR_DEFAULT_WIDTH;
        }
        self.sidebar_width = self
            .sidebar_width
            .clamp(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);

        // A report route is not worth restoring across launches
        // (specification §32).
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
///
/// Collected while rendering and executed afterwards, so no widget ever holds a
/// borrow of the backend during a frame.
#[derive(Clone, Debug)]
pub enum AppCommand {
    SelectEntity(EntityId),
    Navigate(Route),
    NavigateBack,

    OpenStartModal(EntityId),
    UpdateParameterDraft(String),
    SubmitStart {
        entity_id: EntityId,
        parameters: String,
    },

    RequestCancel(CancelTarget),
    ConfirmCancel(CancelTarget),

    CloseOverlay,
    OpenAddDemoFolder,
    AddDemoEntity(DemoEntityKind),
    Refresh,
    RetryQuery(RunId),
    OpenReportExternally(RunId),
    SwitchMode(AppMode),
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
    backend: Box<dyn PrototypeBackend>,
    pub ui: UiState,
    /// The real engine. `None` only when the private store could not be
    /// loaded; coco mode then shows an explanatory page.
    coco: Option<Coco>,
    coco_ui: CocoUiState,
    /// A submitted start, performed on the next frame.
    ///
    /// The mock is synchronous, so without this the `Starting…` state of §15.4
    /// would never be rendered and its code path would be dead. Deferring by one
    /// frame also matches the shape a real, slow backend will need.
    pending_start: Option<(EntityId, String)>,
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
        let coco = match Coco::new(default_store_path()) {
            Ok(coco) => Some(coco),
            Err(error) => {
                log::warn!("coco engine failed to start: {error}");
                None
            }
        };

        Self {
            backend: Box::new(MockBackend::new(Local::now())),
            ui,
            coco,
            coco_ui: CocoUiState::default(),
            pending_start: None,
            pending_url: None,
        }
    }

    /// Test seam: build an app around an arbitrary backend, without eframe.
    pub fn with_backend(backend: Box<dyn PrototypeBackend>) -> Self {
        Self {
            backend,
            ui: UiState::default(),
            coco: None,
            coco_ui: CocoUiState::default(),
            pending_start: None,
            pending_url: None,
        }
    }

    /// Perform any start submitted on the previous frame.
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

    /// Prototype controls, for the developer menu and for tests.
    pub fn backend_mut(&mut self) -> &mut dyn PrototypeBackend {
        self.backend.as_mut()
    }

    pub fn route(&self) -> &Route {
        &self.ui.route
    }

    /// Repair the route if it points at something that is gone.
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
                // Selecting clears the run-history search so the new entity's
                // history is not silently filtered (specification §9.1).
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
                let draft = snapshot
                    .entity(&entity_id)
                    .map(|entity| entity.initial_parameters())
                    .unwrap_or_default();
                self.ui.overlay = Overlay::StartRun {
                    entity_id,
                    parameter_draft: draft,
                    submit_state: SubmitState::Idle,
                };
                // Opening the modal focuses the parameter field
                // (specification §25).
                self.ui.focus_parameter_field = true;
            }

            AppCommand::UpdateParameterDraft(text) => {
                if let Overlay::StartRun {
                    parameter_draft, ..
                } = &mut self.ui.overlay
                {
                    *parameter_draft = text;
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
                    // The user stays exactly where they were (specification §16.3).
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

            AppCommand::OpenAddDemoFolder => self.ui.overlay = Overlay::AddDemoFolder,

            AppCommand::AddDemoEntity(kind) => {
                self.backend.add_demo_entity(kind);
                self.ui.overlay = Overlay::None;
                // Adding must update the Library immediately (specification §11.5).
                if let Some(entity) = self.backend.snapshot().entities.last() {
                    let id = entity.id.clone();
                    let name = entity.name.clone();
                    self.ui.route = Route::EntityOverview { entity_id: id };
                    self.ui.notify(format!("Added {name}."));
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

            AppCommand::SwitchMode(mode) => self.ui.mode = mode,

            AppCommand::Notify(text) => self.ui.notify(text),
        }
    }

    fn perform_start(&mut self, entity_id: EntityId, parameters: String) {
        let kind = self
            .backend
            .snapshot()
            .entity(&entity_id)
            .map(|entity| entity.kind);

        match self.backend.start(&entity_id, parameters) {
            Ok(run_id) => {
                self.ui.overlay = Overlay::None;
                self.ui.route = match kind {
                    Some(crate::model::EntityKind::Bench) => Route::BenchRunDetail {
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
                // The modal stays open and the draft is preserved
                // (specification §15.4).
                if let Overlay::StartRun { submit_state, .. } = &mut self.ui.overlay {
                    *submit_state = SubmitState::Failed(error.to_string());
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Coco mode
    // ------------------------------------------------------------------

    fn execute_coco(&mut self, command: CocoCommand) {
        let Some(coco) = &mut self.coco else {
            self.coco_ui
                .notify_error("The coco engine is not available.");
            return;
        };

        match command {
            CocoCommand::Navigate(route) => self.coco_ui.route = route,

            CocoCommand::Back => {
                if let Some(parent) = parent_route(&self.coco_ui.route) {
                    self.coco_ui.route = parent;
                }
            }

            CocoCommand::OpenRegister => {
                self.coco_ui.overlay = CocoOverlay::RegisterFolder;
                self.coco_ui.register_error = None;
            }

            CocoCommand::Register => {
                let path = self.coco_ui.register_path.trim().to_owned();
                match coco.register(std::path::Path::new(&path)) {
                    Ok(()) => {
                        self.coco_ui.overlay = CocoOverlay::None;
                        self.coco_ui.register_error = None;
                        self.coco_ui.notify(format!("Registered {path}."));
                        if let Ok(manifest) =
                            crate::coco::Manifest::load(std::path::Path::new(&path))
                        {
                            self.coco_ui.route = match manifest.kind() {
                                Kind::Job => CocoRoute::JobOverview {
                                    path: std::path::PathBuf::from(&path),
                                },
                                Kind::Bench => CocoRoute::BenchOverview {
                                    path: std::path::PathBuf::from(&path),
                                },
                            };
                        }
                    }
                    Err(error) => self.coco_ui.register_error = Some(error.to_string()),
                }
            }

            CocoCommand::Unregister { path } => match coco.unregister(&path) {
                Ok(()) => {
                    self.coco_ui
                        .notify(format!("Removed {} from the library.", path.display()));
                    if self.coco_ui.route.entity_path() == Some(&path) {
                        self.coco_ui.route = CocoRoute::Library;
                    }
                }
                Err(error) => self.coco_ui.notify_error(error.to_string()),
            },

            CocoCommand::OpenStartJob { path } => {
                let fields = coco
                    .job_manifest(&path)
                    .map(|manifest| {
                        declared_params(&manifest.render_params, &manifest.launch_params)
                    })
                    .unwrap_or_default();
                self.coco_ui.overlay = CocoOverlay::StartJob {
                    path,
                    fields,
                    submitting: false,
                    error: None,
                };
            }

            CocoCommand::FillLastArgs { path } => {
                if let CocoOverlay::StartJob { fields, .. } = &mut self.coco_ui.overlay
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
                let CocoOverlay::StartJob { fields, .. } = &mut self.coco_ui.overlay else {
                    return;
                };
                let fields = fields.clone();
                let manifest = match coco.job_manifest(&path) {
                    Ok(manifest) => manifest,
                    Err(error) => {
                        self.coco_ui.overlay = CocoOverlay::StartJob {
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
                self.coco_ui.overlay = CocoOverlay::StartJob {
                    path: path.clone(),
                    fields: fields.clone(),
                    submitting: true,
                    error: None,
                };
                match coco.start_job(&path, render, launch) {
                    Ok(run_id) => {
                        self.coco_ui.overlay = CocoOverlay::None;
                        self.coco_ui.notify(format!("Started run #{run_id}."));
                        self.coco_ui.route = CocoRoute::JobRunDetail { path, run_id };
                    }
                    Err(error) => {
                        self.coco_ui.overlay = CocoOverlay::StartJob {
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
                self.coco_ui.overlay = CocoOverlay::StartBench {
                    path,
                    fields,
                    plan: None,
                    submitting: false,
                    error: None,
                };
            }

            CocoCommand::PlanBench { path } => {
                let CocoOverlay::StartBench { fields, .. } = &mut self.coco_ui.overlay else {
                    return;
                };
                let fields = fields.clone();
                match coco.plan_bench(&path, fields.clone()) {
                    Ok(instances) => {
                        self.coco_ui.overlay = CocoOverlay::StartBench {
                            path: path.clone(),
                            fields,
                            plan: Some(instances),
                            submitting: false,
                            error: None,
                        };
                    }
                    Err(error) => {
                        self.coco_ui.overlay = CocoOverlay::StartBench {
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
                let CocoOverlay::StartBench { fields, .. } = &mut self.coco_ui.overlay else {
                    return;
                };
                let fields = fields.clone();
                self.coco_ui.overlay = CocoOverlay::StartBench {
                    path: path.clone(),
                    fields: fields.clone(),
                    plan: None,
                    submitting: true,
                    error: None,
                };
                match coco.start_bench(&path, fields.clone()) {
                    Ok(start) => {
                        self.coco_ui.overlay = CocoOverlay::None;
                        self.coco_ui.notify(format!(
                            "Bench run #{} dispatched {} member(s), {} launch failure(s).",
                            start.run_id,
                            start.members.len(),
                            start.launch_failures.len()
                        ));
                        self.coco_ui.route = CocoRoute::BenchRunDetail {
                            path,
                            run_id: start.run_id,
                        };
                    }
                    Err(error) => {
                        self.coco_ui.overlay = CocoOverlay::StartBench {
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
                self.coco_ui.overlay = CocoOverlay::ConfirmCancelRun { path, run_id };
            }

            CocoCommand::ConfirmCancelRun { path, run_id } => {
                self.coco_ui.overlay = CocoOverlay::None;
                match coco.cancel_run(&path, run_id) {
                    Ok(()) => self.coco_ui.notify(format!("Run #{run_id} is cancelling.")),
                    Err(error) => self.coco_ui.notify_error(error.to_string()),
                }
            }

            CocoCommand::CancelBench { path, run_id } => {
                self.coco_ui.overlay = CocoOverlay::ConfirmCancelBench { path, run_id };
            }

            CocoCommand::ConfirmCancelBench { path, run_id } => {
                self.coco_ui.overlay = CocoOverlay::None;
                match coco.cancel_bench(&path, run_id) {
                    Ok(results) => {
                        let cancelled = results.iter().filter(|r| r.ok).count();
                        let failed = results.len() - cancelled;
                        self.coco_ui.notify(format!(
                            "Cancelling {cancelled} member(s){}.",
                            if failed > 0 {
                                format!("; {failed} failed")
                            } else {
                                String::new()
                            }
                        ));
                    }
                    Err(error) => self.coco_ui.notify_error(error.to_string()),
                }
            }

            CocoCommand::ReportRun { path, run_id, mode } => {
                match coco.report_run(&path, run_id, mode) {
                    Ok(()) => self
                        .coco_ui
                        .notify(format!("Report for run #{run_id} is ready.")),
                    Err(error) => self.coco_ui.notify_error(error.to_string()),
                }
            }

            CocoCommand::OpenReport { path, run_id } => {
                self.coco_ui.route = CocoRoute::ReportViewer { path, run_id };
            }

            CocoCommand::OpenHtmlReport { path, run_id } => {
                let html_path = path.join("report").join(format!("{run_id}.html"));
                match std::fs::read_to_string(&html_path) {
                    Ok(html) => {
                        let out = std::env::temp_dir().join(format!("coco-report-{run_id}.html"));
                        match std::fs::write(&out, html) {
                            Ok(()) => {
                                self.pending_url = Some(format!("file://{}", encode_path(&out)));
                                self.coco_ui
                                    .notify("Opening the HTML report in your browser…");
                            }
                            Err(error) => self
                                .coco_ui
                                .notify_error(format!("Could not write the report: {error}")),
                        }
                    }
                    Err(_) => self
                        .coco_ui
                        .notify_error("No HTML report is available for this run."),
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
                    None => self.coco_ui.notify_error("That folder is not registered."),
                }
            }

            CocoCommand::RefreshAll => {
                let report = coco.refresh();
                self.apply_refresh_report(&report, true);
            }

            CocoCommand::CloseOverlay => self.coco_ui.overlay = CocoOverlay::None,

            CocoCommand::SwitchToPrototype => self.ui.mode = AppMode::Prototype,

            CocoCommand::Notify(text) => self.coco_ui.notify(text),
        }
    }

    fn poll_job_entity(&mut self, path: &std::path::Path) {
        let Some(coco) = &mut self.coco else {
            return;
        };
        let polled = match coco.poll_job(path) {
            Ok(report) => {
                self.coco_ui.notify(format!(
                    "Polled: {} status change(s).",
                    report.changed.len()
                ));
                Ok(())
            }
            Err(error) => {
                self.coco_ui.notify_error(error.to_string());
                Err(())
            }
        };
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
                    self.coco_ui.notify_error(error.to_string());
                }
            }
        }
        let _ = polled;
        if reported > 0 {
            self.coco_ui
                .notify(format!("{reported} report(s) generated."));
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
                self.coco_ui.notify(format!(
                    "Refreshed: {changes} status change(s), {} report(s).",
                    report.reports_run
                ));
            } else {
                self.coco_ui.notify_error(summarize_errors(&errors));
            }
        } else if !errors.is_empty() && errors != self.coco_ui.last_refresh_errors {
            self.coco_ui.notify_error(summarize_errors(&errors));
        }
        self.coco_ui.last_refresh_errors = errors;
        self.coco_ui.last_refresh = Some(std::time::Instant::now());
    }

    fn recover_coco_route(&mut self) {
        let Some(coco) = &self.coco else {
            return;
        };
        let Some(path) = self.coco_ui.route.entity_path() else {
            return;
        };
        if !coco.entities().iter().any(|view| &view.path == path) {
            self.coco_ui.route = CocoRoute::Library;
        }
    }

    /// Hand an HTML report to the system browser.
    ///
    /// The report is written to the operating system's temporary directory and
    /// opened as a `file://` URL. This is the "open externally" affordance of
    /// §4.2, and is the only filesystem write in the prototype — no manifest is
    /// read, no experiment folder is touched.
    ///
    /// The URL is opened through eframe rather than by running a shell command,
    /// which §41 forbids.
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

    /// Repaint often enough for live durations, but never in a busy loop
    /// (specification §27.4).
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
        match self.ui.mode {
            AppMode::Prototype => self.prototype_ui(ui),
            AppMode::Coco => self.coco_frame(ui),
        }
    }
}

impl ExperimentApp {
    fn prototype_ui(&mut self, ui: &mut egui::Ui) {
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

    /// One frame of the real-backend mode: auto-refresh the engine, render
    /// from immutable reads, execute the collected commands, then schedule
    /// the next tick.
    fn coco_frame(&mut self, ui: &mut egui::Ui) {
        if let Some(coco) = &mut self.coco {
            let due = self
                .coco_ui
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
            let state = &mut self.coco_ui;
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

        if let Some(url) = self.pending_url.take() {
            ui.ctx().open_url(egui::OpenUrl::new_tab(url));
        }

        self.recover_coco_route();
        ui.ctx().request_repaint_after(Duration::from_millis(500));
    }
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
