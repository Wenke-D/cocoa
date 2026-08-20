#![warn(clippy::all)]
// Hide the console window on Windows in release builds. Harmless elsewhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use coco::{APP_TITLE, ExperimentApp};

fn main() -> eframe::Result {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // `--dump-state` prints the exact world the UI renders from and exits. A
    // symptom on screen ("the run is not listed") becomes a fact you can grep:
    // the run is absent from `job_runs`, or present but missing from
    // `runs_by_job`, and those are different bugs.
    if std::env::args().any(|arg| arg == "--dump-state") {
        dump_state();
        return Ok(());
    }

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title(APP_TITLE)
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([900.0, 600.0]),
        ..Default::default()
    };

    eframe::run_native(
        "coco",
        native_options,
        Box::new(|cc| Ok(Box::new(ExperimentApp::new(cc)))),
    )
}

/// Prints the world as JSON, on the same store the app itself would open.
fn dump_state() {
    use coco::adapter::{EngineAdapter, Experiments};
    use coco::engine::Coco;

    let store = coco::app::default_store_path();
    let engine = match Coco::new(store.clone()) {
        Ok(engine) => engine,
        Err(error) => {
            eprintln!("cannot open the store at {}: {error}", store.display());
            std::process::exit(1);
        }
    };

    let experiments = EngineAdapter::new(engine);
    let snapshot = experiments.snapshot();
    match serde_json::to_string_pretty(&*snapshot) {
        Ok(json) => println!("{json}"),
        Err(error) => {
            eprintln!("cannot serialize the world: {error}");
            std::process::exit(1);
        }
    }
}
