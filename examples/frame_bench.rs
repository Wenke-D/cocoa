//! How long one frame of this UI actually costs.
//!
//! Runs the real shell against a real `Context`, headless — no window, no GPU —
//! and times the two halves of the CPU work: laying the frame out (which is
//! where our own code and egui's text layout live) and tessellating it into
//! triangles. What is left out is the GPU submission, which for a UI this size
//! is a handful of draw calls.
//!
//! ```sh
//! cargo run --release --example frame_bench
//! ```
//!
//! Compare against a debug build to see what the optimiser is worth here.

use std::time::{Duration, Instant};

use chrono::Local;
use experiment_manager::app::{ExperimentApp, ViewCtx};
use experiment_manager::backend::{MockBackend, PrototypeBackend};
use experiment_manager::model::{EntityId, ReportFormat, ReportState};
use experiment_manager::navigation::{ReportContext, Route};

const WINDOW: egui::Vec2 = egui::vec2(1280.0, 820.0);
/// Frames to discard before timing, so caches are in the state they would be in
/// during use rather than on the very first paint.
const WARMUP: usize = 20;
const SAMPLES: usize = 200;

/// Puts the app on the page a case wants to measure, and stages whatever the
/// page needs to show.
type Setup = Box<dyn Fn(&mut ExperimentApp)>;

fn main() {
    let cases: Vec<(&str, Setup)> = vec![
        (
            "Job overview (4 active runs, 20-row history)",
            Box::new(|app: &mut ExperimentApp| {
                app.ui.route = Route::EntityOverview {
                    entity_id: EntityId::new("solver-gpu"),
                };
            }),
        ),
        (
            "Job overview, 500-run history (table virtualised)",
            Box::new(|app: &mut ExperimentApp| {
                app.ui.route = Route::EntityOverview {
                    entity_id: EntityId::new("prepare-data"),
                };
            }),
        ),
        (
            "Job overview, 60 active runs (cards, not virtualised)",
            Box::new(|app: &mut ExperimentApp| {
                let job = EntityId::new("solver-gpu");
                for _ in 0..60 {
                    let _ = app.backend_mut().start(&job, "--mesh=256".to_owned());
                }
                app.ui.route = Route::EntityOverview { entity_id: job };
            }),
        ),
        (
            "Bench run detail (dispatch table)",
            Box::new(|app: &mut ExperimentApp| {
                let snapshot = app.snapshot();
                let run = snapshot
                    .bench_runs
                    .values()
                    .find(|run| run.status.is_active())
                    .expect("a Bench run in flight");
                app.ui.route = Route::BenchRunDetail {
                    bench_id: run.bench_id.clone(),
                    run_id: run.id.clone(),
                };
            }),
        ),
        (
            "Report viewer, long report (rows virtualised)",
            Box::new(|app: &mut ExperimentApp| {
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
                    .expect("a plain-text report");
                app.ui.route = Route::ReportViewer {
                    context: ReportContext::JobRun {
                        job_id: run.job_id.clone(),
                    },
                    run_id: run.id.clone(),
                };
            }),
        ),
    ];

    println!(
        "{:<54} {:>10} {:>12} {:>10}",
        format!(
            "profile: {}",
            if cfg!(debug_assertions) {
                "debug"
            } else {
                "release"
            }
        ),
        "layout",
        "tessellate",
        "total"
    );

    for (name, setup) in cases {
        let (median, tessellate) = measure(&setup);
        println!(
            "{name:<54} {:>9.3}ms {:>11.3}ms {:>9.3}ms",
            median.as_secs_f64() * 1e3,
            tessellate.as_secs_f64() * 1e3,
            (median + tessellate).as_secs_f64() * 1e3,
        );
    }
}

fn measure(setup: &dyn Fn(&mut ExperimentApp)) -> (Duration, Duration) {
    let ctx = egui::Context::default();
    experiment_manager::ui::theme::install(&ctx);

    let mut backend = MockBackend::new(Local::now());
    backend.set_auto_progressing(false);
    // One Job carries a history long enough to be worth virtualising.
    backend.generate_history(&EntityId::new("prepare-data"), 500);

    let mut app = ExperimentApp::with_backend(Box::new(backend));
    setup(&mut app);

    let mut layout = Vec::with_capacity(SAMPLES);
    let mut tessellate = Vec::with_capacity(SAMPLES);

    for index in 0..WARMUP + SAMPLES {
        let input = egui::RawInput {
            screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, WINDOW)),
            ..Default::default()
        };

        let now = Local::now();
        let snapshot = app.snapshot();
        let mut commands = Vec::new();

        let started = Instant::now();
        let output = ctx.run_ui(input, |ctx| {
            egui::CentralPanel::default()
                .frame(egui::Frame::NONE)
                .show(ctx, |ui| {
                    let mut view = ViewCtx {
                        state: &mut app.ui,
                        snapshot: &snapshot,
                        now,
                        commands: &mut commands,
                    };
                    experiment_manager::ui::shell::show(&mut view, ui);
                });
        });
        let laid_out = started.elapsed();

        let started = Instant::now();
        let meshes = ctx.tessellate(output.shapes, output.pixels_per_point);
        let tessellated = started.elapsed();
        std::hint::black_box(meshes);

        // There is no renderer here to consume the font atlas updates, and
        // epaint refuses to let them be dropped unnoticed.
        let mut textures = output.textures_delta;
        textures.clear();

        if index >= WARMUP {
            layout.push(laid_out);
            tessellate.push(tessellated);
        }
    }

    (median(&mut layout), median(&mut tessellate))
}

fn median(samples: &mut [Duration]) -> Duration {
    samples.sort_unstable();
    samples[samples.len() / 2]
}
