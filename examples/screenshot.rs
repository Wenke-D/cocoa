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
//! Surfaces: `job` (default) | `run-detail` | `start-modal` |
//! `start-modal-last` (one run already started, so the modal offers its history
//! action) | `bench-modal` | `cancel-modal`.

use std::collections::BTreeMap;
use std::sync::Arc;

use experiment_manager::adapter::CancelTarget;
use experiment_manager::app::{AppCommand, ExperimentApp, ThemePreference};
use experiment_manager::navigation::{Overlay, Route, SubmitState};

/// Frames to render before capturing, so fonts and panel sizes have settled.
const WARMUP_FRAMES: u32 = 8;

struct Harness {
    app: ExperimentApp,
    path: String,
    frame: u32,
    requested: bool,
}

impl eframe::App for Harness {
    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.app.ui(ui, frame);

        self.frame += 1;
        let ctx = ui.ctx().clone();

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
fn arrange(app: &mut ExperimentApp, surface: &str) {
    let snapshot = app.snapshot();
    let wanted = if surface.starts_with("bench") {
        "nightly-benchmark"
    } else {
        "solver-gpu"
    };
    let Some(job) = snapshot.entities.iter().find(|e| e.name == wanted) else {
        panic!("the bundled mock library did not register");
    };

    app.ui.route = Route::EntityOverview {
        entity_id: job.id.clone(),
    };

    // A modal only offers its history action once something has run.
    if matches!(surface, "start-modal-last" | "run-detail") {
        let parameters = job
            .parameter_names
            .iter()
            .map(|name| (name.clone(), "1".to_owned()))
            .collect();
        app.execute(AppCommand::SubmitStart {
            entity_id: job.id.clone(),
            parameters,
        });
        app.poll();
    }

    match surface {
        "start-modal" | "start-modal-last" | "bench-modal" => {
            let fields: BTreeMap<String, String> = job
                .parameter_names
                .iter()
                .map(|name| (name.clone(), String::new()))
                .collect();
            app.ui.overlay = Overlay::StartRun {
                entity_id: job.id.clone(),
                fields,
                submit_state: SubmitState::Idle,
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
        "experiment_manager_screenshot",
        native_options,
        Box::new(move |cc| {
            let mut app = ExperimentApp::new(cc);
            app.ui.theme = theme;
            app.ui.theme.apply(&cc.egui_ctx);
            app.ui.sidebar_open = true;
            app.add_folder(std::path::Path::new("mock"));
            arrange(&mut app, &surface);

            Ok(Box::new(Harness {
                app,
                path,
                frame: 0,
                requested: false,
            }))
        }),
    )
}
