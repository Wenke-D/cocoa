//! Cancel confirmation (specification §16).
//!
//! Cancel is destructive, so it always asks first, and the copy states exactly
//! what will and will not be touched.

use crate::adapter::CancelTarget;
use crate::app::{AppCommand, ViewCtx};
use crate::ui::overlays::modal_frame;
use crate::ui::widgets::button::Button;
use crate::ui::{space, text};
use crate::view_model::format_duration;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, target: &CancelTarget, error: Option<&str>) {
    let now = ctx.now;
    let snapshot = ctx.snapshot;

    let Some(copy) = describe(snapshot, target, now) else {
        ctx.push(AppCommand::CloseOverlay);
        return;
    };

    modal_frame(ctx, ui, "confirm_cancel", |ctx, ui| {
        ui.label(text::title(&copy.title));
        ui.add_space(space::SECTION);

        ui.label(text::strong(&copy.subject));
        ui.add_space(space::SMALL);
        for line in &copy.lines {
            ui.label(line);
        }

        if let Some(error) = error {
            ui.add_space(space::SECTION);
            ui.label(text::error(ui, error));
        }

        ui.add_space(space::SECTION);
        ui.horizontal(|ui| {
            if Button::secondary("Keep Running").show(ui).clicked() {
                ctx.push(AppCommand::CloseOverlay);
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if Button::primary(&copy.confirm).show(ui).clicked() {
                    ctx.push(AppCommand::ConfirmCancel(target.clone()));
                }
            });
        });
    });
}

struct Copy {
    title: String,
    subject: String,
    lines: Vec<String>,
    confirm: String,
}

fn describe(
    snapshot: &crate::view_model::Snapshot,
    target: &CancelTarget,
    now: chrono::DateTime<chrono::Local>,
) -> Option<Copy> {
    match target {
        CancelTarget::JobRun(run_id) => {
            let run = snapshot.job_run(run_id)?;
            Some(Copy {
                title: "Cancel this Job run?".to_owned(),
                subject: snapshot.entity_name(&run.job_id).to_owned(),
                lines: vec![
                    format!("Started at {}", run.started_at.format("%H:%M:%S")),
                    format!("Running for {}.", format_duration(run.duration(now))),
                    String::new(),
                    "The cancellation operation defined by the manifest will be requested."
                        .to_owned(),
                ],
                confirm: "Cancel Run".to_owned(),
            })
        }

        CancelTarget::BenchRun(run_id) => {
            let bench_run = snapshot.bench_run(run_id)?;
            let progress = snapshot.bench_progress(bench_run);
            let still_active = progress.running;
            let finished = progress.finished();

            Some(Copy {
                title: "Cancel this Bench run?".to_owned(),
                subject: snapshot.entity_name(&bench_run.bench_id).to_owned(),
                lines: vec![
                    format!("All {still_active} runs still active will be cancelled."),
                    format!("{finished} runs have already finished and keep their results."),
                    String::new(),
                    "Runs of the same Jobs started outside this Bench are not affected.".to_owned(),
                ],
                confirm: "Cancel Bench".to_owned(),
            })
        }
    }
}
