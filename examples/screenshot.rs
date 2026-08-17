//! Development aid: boot the app, let it settle, and write a PNG of one frame.
//!
//! Screen-capture tooling is not always available (and is never available in
//! CI), so the window screenshots itself through the viewport command egui
//! already provides.
//!
//! ```sh
//! cargo run --example screenshot -- light out/light.png
//! ```
//!
//! Optional third argument switches the sidebar view: `library`, `search`, or
//! `running`.

use std::sync::Arc;

use experiment_manager::app::{ExperimentApp, SidebarView, ThemePreference};
use experiment_manager::navigation::Route;

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

/// Where to point the app. The report routes hunt for a run with a readable
/// plain-text report — that is the body `text_body` lays out, and the format
/// the fixtures assign is not something the caller gets to pick.
fn route(app: &ExperimentApp, page: &str) -> Route {
    use experiment_manager::model::{EntityId, ReportFormat, ReportState};
    use experiment_manager::navigation::ReportContext;

    if page.starts_with("report") {
        let snapshot = app.snapshot();
        let run = snapshot
            .job_runs
            .values()
            .find(|run| {
                matches!(
                    run.report,
                    ReportState::Available {
                        format: ReportFormat::PlainText,
                        ..
                    }
                )
            })
            .expect("a fixture run with a plain-text report");
        return Route::ReportViewer {
            context: ReportContext::JobRun {
                job_id: run.job_id.clone(),
            },
            run_id: run.id.clone(),
        };
    }

    // The two surfaces that draw a Bench progress bar. Which fixture Bench is
    // mid-flight is the fixtures' business, so it is looked up rather than named.
    if page.starts_with("progress") {
        let snapshot = app.snapshot();
        let run = snapshot
            .bench_runs
            .values()
            .find(|run| run.status.is_active())
            .expect("a fixture Bench run in flight");
        return if page == "progress-detail" {
            Route::BenchRunDetail {
                bench_id: run.bench_id.clone(),
                run_id: run.id.clone(),
            }
        } else {
            Route::EntityOverview {
                entity_id: run.bench_id.clone(),
            }
        };
    }

    Route::EntityOverview {
        entity_id: EntityId::new(if page == "bench" {
            "nightly-benchmark"
        } else {
            "solver-gpu"
        }),
    }
}

fn main() -> eframe::Result {
    let mut args = std::env::args().skip(1);
    let theme = match args.next().as_deref() {
        Some("dark") => ThemePreference::Dark,
        _ => ThemePreference::Light,
    };
    let path = args.next().unwrap_or_else(|| "screenshot.png".to_owned());
    let view = match args.next().as_deref() {
        Some("running") => SidebarView::Running,
        _ => SidebarView::Library,
    };
    // `job` (default) | `bench` | `report` | `report-wrapped`
    let page = args.next().unwrap_or_default();
    // Optional: a term to type into the report search, to shoot the highlights.
    let search = args.next().unwrap_or_default();

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
            // Ignore whatever the real app persisted; a shot must be reproducible.
            app.ui.theme = theme;
            app.ui.theme.apply(&cc.egui_ctx);
            app.ui.sidebar_view = view;
            app.ui.sidebar_open = true;
            app.ui.report_wrap_lines = page == "report-wrapped";
            app.ui.report_search = search;
            app.ui.route = route(&app, &page);

            Ok(Box::new(Harness {
                app,
                path,
                frame: 0,
                requested: false,
            }))
        }),
    )
}
