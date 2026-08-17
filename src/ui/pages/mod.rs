//! Full-page views rendered into the single main-content region.
//!
//! Every detail view is a page here — never a side panel, never a small modal
//! (specification §7.3, §7.4).

pub mod bench_overview;
pub mod bench_run_detail;
pub mod child_run_detail;
pub mod empty_library;
pub mod job_overview;
pub mod job_run_detail;
pub mod pending;
pub mod report_viewer;

use crate::app::ViewCtx;
use crate::model::EntityKind;
use crate::navigation::Route;
use crate::ui::widgets::breadcrumbs;

/// Dispatch the current route to its page.
pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let route = ctx.state.route.clone();

    match route {
        Route::EmptyLibrary => empty_library::show(ctx, ui),

        Route::EntityOverview { entity_id } => {
            let Some(entity) = ctx.snapshot.entity(&entity_id).cloned() else {
                // Recovery runs after this frame; render nothing rather than panic.
                return;
            };

            breadcrumbs::show(ctx, ui);

            match entity.kind {
                EntityKind::Job => job_overview::show(ctx, ui, &entity),
                EntityKind::Bench => bench_overview::show(ctx, ui, &entity),
            }
        }

        Route::JobRunDetail { job_id, run_id } => job_run_detail::show(ctx, ui, &job_id, &run_id),

        Route::BenchRunDetail { bench_id, run_id } => {
            bench_run_detail::show(ctx, ui, &bench_id, &run_id)
        }

        Route::BenchChildRunDetail {
            bench_id,
            bench_run_id,
            child_run_id,
        } => child_run_detail::show(ctx, ui, &bench_id, &bench_run_id, &child_run_id),

        Route::ReportViewer { context, run_id } => report_viewer::show(ctx, ui, &context, &run_id),
    }
}
