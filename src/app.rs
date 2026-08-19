//! Application root.
//!
//! Frame shape:
//!
//! ```text
//! apply the worker's events → take an immutable snapshot → render
//! → collect commands → send or apply them → update route/overlay
//! → schedule repaint
//! ```
//!
//! The UI is handed a snapshot and a command sink. It has no access to the
//! engine at all — the engine lives with its one owner, the worker
//! ([`crate::worker`]), and everything the window asks for comes back as a
//! [`WorkEvent`] or as the next snapshot.

use std::collections::BTreeMap;
use std::time::Duration;

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};

use crate::adapter::{CancelTarget, EngineAdapter, Experiments};
use crate::engine::Coco;
use crate::navigation::{Overlay, Route, SubmitState};
use crate::view_model::Snapshot;
use crate::view_model::{EntityId, RunId, RunStatus};
use crate::worker::{WorkCommand, WorkEvent, Worker};

/// The product name, shown in the platform window title.
pub const APP_TITLE: &str = "coco";

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

/// The Start page's working state (specification §15).
///
/// One draft at a time. Leaving the page discards it, which is what closing the
/// modal used to do.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StartDraft {
    /// Whose form this is. A draft for another experiment is stale and is
    /// replaced rather than shown.
    pub entity_id: Option<EntityId>,
    /// One value per declared parameter, by name (convention §2).
    pub fields: BTreeMap<String, String>,
    pub submit_state: SubmitState,
}

impl StartDraft {
    /// The draft for `entity_id`, or a fresh one if the last draft was another
    /// experiment's.
    pub fn open(&mut self, entity_id: &EntityId, parameter_names: &[String]) {
        if self.entity_id.as_ref() != Some(entity_id) {
            *self = Self {
                entity_id: Some(entity_id.clone()),
                fields: parameter_names
                    .iter()
                    .map(|name| (name.clone(), String::new()))
                    .collect(),
                submit_state: SubmitState::Idle,
            };
        }
    }
}

/// Which view the activity bar has open in the sidebar.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum SidebarView {
    #[default]
    Explorer,
    Running,
}

impl SidebarView {
    pub const ALL: [Self; 2] = [Self::Explorer, Self::Running];

    pub fn title(self) -> &'static str {
        match self {
            Self::Explorer => "Explorer",
            Self::Running => "Active Runs",
        }
    }

    pub fn tooltip(self) -> &'static str {
        match self {
            Self::Explorer => "Explorer",
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
    /// What the user has typed on the Start page, and how a submission went.
    ///
    /// Not in the route: a route is a place, and half a filled-in form is not
    /// one. Not persisted either — the values are gone on relaunch, so
    /// restoring the page they belonged to would only show an empty form
    /// somebody did not ask for.
    #[serde(skip)]
    pub start_draft: StartDraft,
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
            start_draft: StartDraft::default(),
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
    /// What a restored `UiState` becomes before it is used.
    ///
    /// Public so a test can check it without an eframe context: what a relaunch
    /// does with a persisted route is behaviour, not an implementation detail.
    pub fn sanitize(&mut self) {
        if !self.sidebar_width.is_finite() {
            self.sidebar_width = SIDEBAR_DEFAULT_WIDTH;
        }
        self.sidebar_width = self
            .sidebar_width
            .clamp(SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
        if self.route.is_report() {
            self.route = Route::EmptyExplorer;
        }
        // A route is restored on launch and a Start draft is not, so restoring
        // the page would open an empty form nobody asked for. Land on the
        // experiment it belonged to (specification §15).
        if let Route::StartRun { entity_id } = &self.route {
            self.route = Route::EntityOverview {
                entity_id: entity_id.clone(),
            };
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

    OpenStartPage(EntityId),
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
    pub snapshot: &'a Snapshot,
    pub now: DateTime<Local>,
    pub commands: &'a mut Vec<AppCommand>,
}

impl ViewCtx<'_> {
    pub fn push(&mut self, command: AppCommand) {
        self.commands.push(command);
    }
}

/// Who pumps the worker.
enum Backend {
    /// Production: the worker runs on its own thread and wakes the window
    /// when the world changes.
    Threaded(crate::worker::Handle),
    /// Tests: the same worker, pumped inline by [`ExperimentApp::apply_pending`],
    /// so every outcome is observable as soon as the command returns. No
    /// thread, no timing.
    Local {
        worker: Worker,
        handle: crate::worker::Handle,
    },
}

impl Backend {
    fn handle(&self) -> &crate::worker::Handle {
        match self {
            Self::Threaded(handle) => handle,
            Self::Local { handle, .. } => handle,
        }
    }
}

pub struct ExperimentApp {
    backend: Backend,
    /// Held for its lifetime, not its methods: dropping it unbinds the socket
    /// and removes the file (specification §43).
    #[cfg(unix)]
    #[allow(dead_code, reason = "kept alive so its Drop runs at exit")]
    agent_server: Option<crate::agent::Server>,
    pub ui: UiState,
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

        // The interface an agent drives coco through (specification §43).
        // Failing to bind is not fatal: another coco already owns the socket,
        // or the directory is not writable, and a workbench without an agent
        // interface is still a workbench.
        #[cfg(unix)]
        let (bridge, agent_server) = {
            let bridge = crate::agent::Bridge::new();
            match crate::agent::Server::start(
                crate::agent::default_socket_path(),
                std::sync::Arc::clone(&bridge),
            ) {
                Ok(server) => (Some(bridge), Some(server)),
                Err(error) => {
                    log::warn!("agent interface unavailable: {error}");
                    (None, None)
                }
            }
        };

        let handle = Worker::spawn(
            Box::new(EngineAdapter::new(engine)),
            #[cfg(unix)]
            bridge,
            Some(cc.egui_ctx.clone()),
        )
        .expect("the worker thread must start");

        Self {
            backend: Backend::Threaded(handle),
            ui,
            #[cfg(unix)]
            agent_server,
            pending_url: None,
        }
    }

    /// Test seam: build an app around an arbitrary implementation, without
    /// eframe. The worker is owned rather than spawned, so every command's
    /// outcome is observable as soon as the call returns.
    pub fn with_experiments(experiments: Box<dyn Experiments + Send>) -> Self {
        let (worker, handle) = Worker::local(experiments);
        Self {
            backend: Backend::Local { worker, handle },
            ui: UiState::default(),
            #[cfg(unix)]
            agent_server: None,
            pending_url: None,
        }
    }

    /// Catches up with the worker: pumps it when this app owns it (tests),
    /// then applies every outcome it has sent.
    pub fn apply_pending(&mut self) {
        if let Backend::Local { worker, .. } = &mut self.backend {
            worker.step(Local::now());
        }
        let mut events = Vec::new();
        while let Some(event) = self.backend.handle().next_event() {
            events.push(event);
        }
        for event in events {
            self.apply_event(event);
        }
    }

    /// Hands the worker a command and catches up, so that in a test the
    /// outcome is already applied when this returns.
    fn send(&mut self, command: WorkCommand) {
        self.backend.handle().send(command);
        self.apply_pending();
    }

    pub fn snapshot(&self) -> Snapshot {
        self.backend.handle().snapshot()
    }

    /// The URL queued for the system browser, if any. Exposed for tests.
    pub fn pending_url(&self) -> Option<&str> {
        self.pending_url.as_deref()
    }

    pub fn route(&self) -> &Route {
        &self.ui.route
    }

    pub fn recover_route(&mut self) {
        let snapshot = self.snapshot();
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

            AppCommand::OpenStartPage(entity_id) => {
                let snapshot = self.snapshot();
                let names = snapshot
                    .entity(&entity_id)
                    .map(|entity| entity.parameter_names.clone())
                    .unwrap_or_default();
                self.ui.start_draft.open(&entity_id, &names);
                self.ui.route = Route::StartRun { entity_id };
                self.ui.focus_parameter_field = true;
            }

            AppCommand::FillLastArgs(entity_id) => {
                let snapshot = self.snapshot();
                if let Some(entity) = snapshot.entity(&entity_id) {
                    for (name, value) in &entity.last_used {
                        if self.ui.start_draft.fields.contains_key(name) {
                            self.ui
                                .start_draft
                                .fields
                                .insert(name.clone(), value.clone());
                        }
                    }
                }
            }

            AppCommand::SubmitStart {
                entity_id,
                parameters,
            } => {
                // `Submitting` renders until the worker answers with
                // `Started` or `StartRefused`.
                self.ui.start_draft.submit_state = SubmitState::Submitting;
                self.send(WorkCommand::Start {
                    entity_id,
                    parameters,
                });
            }

            AppCommand::RequestCancel(target) => {
                self.ui.overlay = Overlay::ConfirmCancel {
                    target,
                    error: None,
                };
            }

            // The overlay stays open until the worker answers: closed by
            // `CancelSucceeded`, annotated by `CancelFailed`.
            AppCommand::ConfirmCancel(target) => self.send(WorkCommand::Cancel(target)),

            AppCommand::CloseOverlay => self.ui.overlay = Overlay::None,

            AppCommand::AddFolder => {
                if let Some(path) = pick_folder() {
                    self.add_folder(&path);
                }
            }

            AppCommand::RetryQuery(run_id) => self.send(WorkCommand::RetryQuery(run_id)),

            AppCommand::Refresh => self.send(WorkCommand::Refresh),

            AppCommand::OpenReportExternally(run_id) => {
                self.send(WorkCommand::OpenReportExternally(run_id));
            }

            AppCommand::Notify(text) => self.ui.notify(text),
        }
    }

    /// Registers a folder the user chose; the outcome — messages, navigation,
    /// the report modal — comes back as a [`WorkEvent::FoldersAdded`].
    pub fn add_folder(&mut self, path: &std::path::Path) {
        self.send(WorkCommand::RegisterFolder(path.to_owned()));
    }

    /// Applies one outcome the worker sent. Everything the engine did to the
    /// world is already in the snapshot; this is only what the *window* does
    /// about it — where to land, what to say, what to open.
    fn apply_event(&mut self, event: WorkEvent) {
        match event {
            WorkEvent::Started {
                entity_id,
                kind,
                run_id,
            } => {
                // The draft did its job. Discarding it here means coming back
                // to Start for this experiment opens the empty form §15.3 asks
                // for, rather than the values that already ran.
                self.ui.start_draft = StartDraft::default();
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

            WorkEvent::StartRefused { entity_id, error } => {
                // Only the draft that asked shows the refusal; a form the
                // user already left is not decorated in absentia.
                if self.ui.start_draft.entity_id.as_ref() == Some(&entity_id) {
                    self.ui.start_draft.submit_state = SubmitState::Failed(error);
                }
            }

            WorkEvent::CancelSucceeded { target } => {
                if matches!(&self.ui.overlay, Overlay::ConfirmCancel { target: t, .. } if *t == target)
                {
                    self.ui.overlay = Overlay::None;
                }
            }

            WorkEvent::CancelFailed { target, message } => {
                if let Overlay::ConfirmCancel {
                    target: t,
                    error: slot,
                } = &mut self.ui.overlay
                    && *t == target
                {
                    *slot = Some(message.clone());
                }
                self.ui.notify_error(message);
            }

            WorkEvent::FoldersAdded {
                picked,
                first_new,
                outcome,
            } => {
                // Land on the first folder this action added, so the user sees
                // the result of the pick rather than wherever they already were.
                if let Some(entity_id) = first_new {
                    self.ui.route = Route::EntityOverview { entity_id };
                }

                // What was registered goes to the status bar, which is where
                // the trace of a successful pick belongs. Refusals do not: each
                // carries its own reason, and one line cannot hold a list of
                // them (specification §11.5).
                let mut parts = Vec::new();
                match outcome.added.len() {
                    0 => {}
                    1 => parts.push(format!("Added {}.", outcome.added[0])),
                    count => parts.push(format!("Added {count} folders.")),
                }
                if outcome.already_registered > 0 {
                    parts.push(format!(
                        "{} already in the Explorer.",
                        outcome.already_registered
                    ));
                }

                if !parts.is_empty() {
                    self.ui.notify(parts.join(" "));
                } else if outcome.refused.is_empty() {
                    self.ui.notify("Nothing to add.");
                }

                if !outcome.refused.is_empty() {
                    self.ui.overlay = Overlay::AddFolderReport { picked, outcome };
                }
            }

            WorkEvent::OpenUrl(url) => self.pending_url = Some(url),
            WorkEvent::Notice(text) => self.ui.notify(text),
            WorkEvent::ErrorNotice(text) => self.ui.notify_error(text),
        }
    }

    fn schedule_repaint(&self, ctx: &egui::Context) {
        let snapshot = self.snapshot();
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
        // What the worker did since the last frame arrives first, so the
        // frame renders a world that already includes it.
        self.apply_pending();
        self.recover_route();

        let snapshot = self.snapshot();
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
        self.apply_pending();

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
