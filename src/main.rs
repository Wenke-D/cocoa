#![warn(clippy::all)]
// Hide the console window on Windows in release builds. Harmless elsewhere.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use experiment_manager::{APP_TITLE, ExperimentApp};

fn main() -> eframe::Result {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let native_options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title(APP_TITLE)
            .with_inner_size([1280.0, 820.0])
            .with_min_inner_size([900.0, 600.0]),
        ..Default::default()
    };

    eframe::run_native(
        "experiment_manager",
        native_options,
        Box::new(|cc| Ok(Box::new(ExperimentApp::new(cc)))),
    )
}
