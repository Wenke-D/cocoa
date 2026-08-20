//! Development aid: boot the app over the bundled mock library, let it settle,
//! and write a PNG of one frame.
//!
//! Screen-capture tooling is not always available (and is never available in
//! CI), so the window screenshots itself through the viewport command egui
//! already provides.
//!
//! ```sh
//! cargo run --example screenshot -- dark out/start-modal.png start-modal
//! ```
//!
//! Surfaces: `job` (default) | `job-active` (the overview with a run in
//! flight, which is what `doc/images/workbench-*.png` document) | `run-detail` |
//! `start-page` | `start-page-last` (one run already started, so the page
//! offers its history action) | `bench-start` | `cancel-modal` |
//! `folder-report` (what an Add Folder pick refused) | `bench-plan-failed`
//! (a Bench start refused because several of its plan's calls are invalid).

use std::sync::Arc;

use coco::adapter::{AddedFolders, CancelTarget};
use coco::app::{AppCommand, ExperimentApp, ThemePreference};
use coco::navigation::{Overlay, Route, SubmitState};

/// Frames to render before capturing, so fonts and panel sizes have settled.
const WARMUP_FRAMES: u32 = 8;

/// Frames to wait for the worker thread to register the library before giving
/// up. Generous: it is a folder scan, and the cost of being wrong is a hang.
const REGISTER_FRAMES: u32 = 600;

struct Harness {
    app: ExperimentApp,
    path: String,
    surface: String,
    /// Commands to the engine are fire-and-forget (§43.3), so the library is
    /// not in the world on the frame it was asked for. Arranging waits.
    arranged: bool,
    /// Whether the run the surface needs has been asked for yet.
    started: bool,
    waited: u32,
    frame: u32,
    requested: bool,
}

impl eframe::App for Harness {
    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.app.ui(ui, frame);

        let ctx = ui.ctx().clone();

        // Nothing to photograph until the world has the experiment in it. The
        // app must keep rendering meanwhile — that is what drains the worker's
        // events — so this waits by returning, not by blocking.
        if !self.arranged {
            if arrange(&mut self.app, &self.surface, &mut self.started) {
                self.arranged = true;
            } else {
                self.waited += 1;
                assert!(
                    self.waited < REGISTER_FRAMES,
                    "the bundled mock library did not register"
                );
                ctx.request_repaint();
                return;
            }
        }

        self.frame += 1;

        if self.frame == WARMUP_FRAMES && !self.requested {
            self.requested = true;
            ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(egui::UserData::default()));
        }

        let image: Option<Arc<egui::ColorImage>> = ctx.input(|input| {
            input.events.iter().find_map(|event| match event {
                egui::Event::Screenshot { image, .. } => Some(image.clone()),
                _ => None,
            })
        });

        if let Some(image) = image {
            write_png(&self.path, &image);
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }

        ctx.request_repaint();
    }
}

fn write_png(path: &str, image: &egui::ColorImage) {
    let [width, height] = image.size;
    let pixels: Vec<u8> = image
        .pixels
        .iter()
        .flat_map(|p| [p.r(), p.g(), p.b(), p.a()])
        .collect();

    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    image::save_buffer(
        path,
        &pixels,
        width as u32,
        height as u32,
        image::ColorType::Rgba8,
    )
    .expect("write screenshot");
    println!("wrote {path} ({width}×{height})");
}

/// Points the app at one surface. Entity ids are folder paths, so they are
/// looked up by manifest name rather than spelled out.
///
/// Answers `false` while the wanted experiment is not in the world yet. The
/// worker owns the engine on its own thread and registration is a command
/// rather than a call (§43.3), so the first frames render an empty Explorer;
/// the caller retries.
fn arrange(app: &mut ExperimentApp, surface: &str, started: &mut bool) -> bool {
    let snapshot = app.snapshot();
    let wanted = if surface.starts_with("bench") {
        "nightly-benchmark"
    } else {
        "solver-gpu"
    };
    let Some(job) = snapshot.entities.iter().find(|e| e.name == wanted) else {
        return false;
    };

    // Surfaces that need something to have run: a modal only offers its
    // history action afterwards, and the overview only shows its active-run
    // card, side bar badge, and status bar count while one is in flight.
    //
    // The start is asked for on one frame and answered on a later one, and its
    // answer navigates to the new run's page (§15.4). So this returns without
    // arranging anything until the run exists — otherwise the route set below
    // is overwritten by the event, and every surface photographs run-detail.
    if matches!(
        surface,
        "start-page-last" | "run-detail" | "job-active" | "cancel-modal"
    ) {
        if !*started {
            let parameters = job
                .parameter_names
                .iter()
                .map(|name| (name.clone(), "1".to_owned()))
                .collect();
            app.execute(AppCommand::SubmitStart {
                entity_id: job.id.clone(),
                parameters,
            });
            *started = true;
            return false;
        }
        app.apply_pending();
        if app.snapshot().job_runs.is_empty() {
            return false;
        }
    }

    app.ui.route = Route::EntityOverview {
        entity_id: job.id.clone(),
    };

    match surface {
        "start-page" | "start-page-last" | "bench-start" => {
            app.ui.start_draft.open(&job.id, &job.parameter_names);
            app.ui.route = Route::StartRun {
                entity_id: job.id.clone(),
            };
        }
        "run-detail" => {
            let run_id = app
                .snapshot()
                .job_runs
                .keys()
                .next()
                .cloned()
                .expect("a run to show");
            app.ui.route = Route::JobRunDetail {
                job_id: job.id.clone(),
                run_id,
            };
        }
        // A Bench start turned down by plan validation, with the shape that
        // matters: several calls at fault, listed together (§15.4).
        "bench-plan-failed" => {
            app.ui.start_draft.open(&job.id, &job.parameter_names);
            app.ui.start_draft.fields = job
                .parameter_names
                .iter()
                .map(|name| (name.clone(), "1".to_owned()))
                .collect();
            app.ui.route = Route::StartRun {
                entity_id: job.id.clone(),
            };
            app.ui.start_draft.submit_state = SubmitState::Failed(
                coco::adapter::ExperimentError::InvalidPlan {
                    calls: 12,
                    problems: vec![
                        "call 2: `solver-xl` is not a registered job".to_owned(),
                        "call 5: job `solver-gpu` — missing `gpu`, extra `device`".to_owned(),
                        "call 9: `solver-xl` is not a registered job".to_owned(),
                    ],
                }
                .explain(),
            );
        }

        // The mix the refusal modal exists for: one pick that registered some
        // folders, found one already there, and turned two down.
        "folder-report" => {
            app.ui.overlay = Overlay::AddFolderReport {
                picked: "~/experiments".to_owned(),
                outcome: AddedFolders {
                    added: vec!["solver-cpu".to_owned(), "sweep-a".to_owned()],
                    already_registered: 1,
                    refused: vec![
                        "solver-copy: an entity named `solver-gpu` is already registered"
                            .to_owned(),
                        "archive: cannot read coco.toml: permission denied".to_owned(),
                    ],
                },
            };
        }

        // Starting navigates to the new run's own page (§15.4). This surface
        // wants the overview it was started from, with the run in flight.
        "job-active" => {
            app.ui.route = Route::EntityOverview {
                entity_id: job.id.clone(),
            };
        }

        "cancel-modal" => {
            let run_id = app
                .snapshot()
                .job_runs
                .keys()
                .next()
                .cloned()
                .expect("a run to cancel");
            app.ui.overlay = Overlay::ConfirmCancel {
                target: CancelTarget::JobRun(run_id),
                error: None,
            };
        }
        _ => {}
    }

    true
}

fn main() -> eframe::Result {
    let mut args = std::env::args().skip(1);
    let theme = match args.next().as_deref() {
        Some("dark") => ThemePreference::Dark,
        _ => ThemePreference::Light,
    };
    let path = args.next().unwrap_or_else(|| "screenshot.png".to_owned());
    let surface = args.next().unwrap_or_default();

    // A shot must be reproducible, so it never touches the real store.
    let store = std::env::temp_dir().join("coco-screenshot-store.json");
    let _ = std::fs::remove_file(&store);
    // SAFETY: single-threaded, before any other thread exists.
    unsafe { std::env::set_var("COCO_STORE_PATH", &store) };

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1280.0, 820.0])
            .with_visible(true),
        ..Default::default()
    };

    eframe::run_native(
        "coco_screenshot",
        native_options,
        Box::new(move |cc| {
            let mut app = ExperimentApp::new(cc);
            app.ui.theme = theme;
            app.ui.theme.apply(&cc.egui_ctx);
            app.ui.sidebar_open = true;
            app.add_folder(std::path::Path::new("../mock"));

            Ok(Box::new(Harness {
                app,
                path,
                surface,
                arranged: false,
                started: false,
                waited: 0,
                frame: 0,
                requested: false,
            }))
        }),
    )
}
