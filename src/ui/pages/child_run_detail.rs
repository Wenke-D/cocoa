//! Bench child-run detail (specification §19).
//!
//! This page and [`super::job_run_detail`] render the same run record and share
//! [`run_detail::show`], so they cannot drift apart. Only the context differs:
//! the Library keeps the *Bench* selected here, and the page offers an explicit
//! link to the Job rather than quietly moving the selection to it.

use crate::app::{AppCommand, ViewCtx};
use crate::navigation::ReportContext;
use crate::ui::widgets::breadcrumbs;
use crate::ui::widgets::run_detail::{self, Surround};
use crate::ui::{space, text};
use crate::view_model::{EntityId, RunId};

pub fn show(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    bench_id: &EntityId,
    bench_run_id: &RunId,
    child_run_id: &RunId,
) {
    breadcrumbs::show(ctx, ui);

    let Some(run) = ctx.snapshot.job_run(child_run_id).cloned() else {
        return;
    };

    let step = ctx
        .snapshot
        .bench_run(bench_run_id)
        .and_then(|bench_run| bench_run.plan.step_for_run(child_run_id))
        .cloned();

    // The Job named here *is* the Library's entry for it — that is the whole
    // point of the corrected model. Offer navigation explicitly.
    let job_name = ctx.snapshot.entity_name(&run.job_id).to_owned();
    ui.horizontal(|ui| {
        ui.label(text::muted("Job"));
        if ui
            .link(&job_name)
            .on_hover_text("Open this Job in the Library")
            .clicked()
        {
            ctx.push(AppCommand::SelectEntity(run.job_id.clone()));
        }
    });
    ui.add_space(space::SECTION);

    let mut extra_fields = vec![(
        "Dispatched by".to_owned(),
        format!("{} · call {}", ctx.snapshot.entity_name(bench_id), {
            step.as_ref().map_or(0, |step| step.index)
        }),
    )];
    if let Some(step) = &step {
        extra_fields.push(("Call".to_owned(), step.index.to_string()));
    }

    let surround = Surround {
        report_context: ReportContext::BenchChildRun {
            bench_id: bench_id.clone(),
            bench_run_id: bench_run_id.clone(),
        },
        extra_fields,
        // The Bench is already named in "Dispatched by" and the breadcrumbs.
        show_source: false,
    };

    run_detail::show(ctx, ui, &run, &surround);
}
