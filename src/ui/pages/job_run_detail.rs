//! Job run detail (specification §17).
//!
//! Reached from a Job's own history. The Library keeps the Job selected.

use crate::app::ViewCtx;
use crate::navigation::ReportContext;
use crate::ui::widgets::breadcrumbs;
use crate::ui::widgets::run_detail::{self, Surround};
use crate::view_model::{EntityId, RunId};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, job_id: &EntityId, run_id: &RunId) {
    breadcrumbs::show(ctx, ui);

    let Some(run) = ctx.snapshot.job_run(run_id).cloned() else {
        // Recovery runs after this frame.
        return;
    };

    let surround = Surround {
        report_context: ReportContext::JobRun {
            job_id: job_id.clone(),
        },
        extra_fields: Vec::new(),
        show_source: true,
    };

    run_detail::show(ctx, ui, &run, &surround);
}
