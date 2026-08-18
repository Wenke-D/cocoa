//! The sidebar (specification §11), styled as VS Code's side bar.
//!
//! One panel, two views, chosen by the activity bar. The Library view is the
//! only persistent navigation surface; the selected row is decided by the route,
//! so viewing a Bench-dispatched run keeps the Bench highlighted even though the
//! run belongs to a Job that is also listed here.
//!
//! The Library carries no filter field (specification §11.1): it is a short,
//! fully visible list of folders the user added themselves. The run-history
//! filters of §22.4 and the report search of §20.2 are unaffected.

use std::sync::Arc;

use egui::text::{LayoutJob, TextFormat, TextWrapping};

use crate::app::{AppCommand, SidebarView, ViewCtx};
use crate::navigation::Route;
use crate::ui::icons;
use crate::ui::space;
use crate::ui::text;
use crate::ui::theme::{self, metrics};
use crate::ui::widgets;
use crate::view_model::{Entity, EntityKind, RunStatus};

/// Left edge of a top-level row's text, matching VS Code's tree indent.
const ROW_INDENT: f32 = 20.0;
/// Inset of the view header's own content from either panel edge.
const TITLE_INSET: f32 = 12.0;
/// Padding between the row's right edge and its status badge.
const ROW_TRAILING: f32 = 10.0;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let view = ctx.state.sidebar_view;

    title_row(ctx, ui, view);

    egui::ScrollArea::vertical()
        .auto_shrink([false, false])
        .show(ui, |ui| match view {
            SidebarView::Library => library(ctx, ui),
            SidebarView::Running => running(ctx, ui),
        });
}

/// `sideBarTitle`: a row of small uppercase text plus this view's actions.
fn title_row(ctx: &mut ViewCtx, ui: &mut egui::Ui, view: SidebarView) {
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), metrics::VIEW_HEADER),
        egui::Sense::hover(),
    );

    let (font, color) = text::panel_header_paint(ui);
    ui.painter().text(
        egui::pos2(rect.left() + TITLE_INSET, rect.center().y),
        egui::Align2::LEFT_CENTER,
        view.title().to_uppercase(),
        font,
        color,
    );

    if view == SidebarView::Library {
        // The one title action, mirroring the Explorer's "New File" icon. Its
        // box is inset from the right edge by the same amount the title text is
        // from the left, so the row reads as one strip rather than an icon
        // pushed against the panel border.
        let button = egui::Rect::from_center_size(
            egui::pos2(
                rect.right() - TITLE_INSET - metrics::ICON_BUTTON / 2.0,
                rect.center().y,
            ),
            egui::vec2(metrics::ICON_BUTTON, metrics::ICON_BUTTON),
        );
        let clicked = widgets::icon_button_at(
            ui,
            button,
            ui.id().with("sidebar_add"),
            "Add Folder",
            icons::plus,
        )
        .clicked();
        if clicked {
            ctx.push(AppCommand::AddFolder);
        }
    }
}

// ---------------------------------------------------------------------------
// Library view
// ---------------------------------------------------------------------------

fn library(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    section(ctx, ui, "Benches", EntityKind::Bench, |state| {
        &mut state.benches_section_open
    });
    section(ctx, ui, "Jobs", EntityKind::Job, |state| {
        &mut state.jobs_section_open
    });
}

fn section(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    heading: &str,
    kind: EntityKind,
    open_flag: fn(&mut crate::app::UiState) -> &mut bool,
) {
    let open = *open_flag(ctx.state);
    if section_header(ui, heading, open).clicked() {
        let flag = open_flag(ctx.state);
        *flag = !*flag;
    }
    if !open {
        return;
    }

    let matches: Vec<Entity> = ctx.snapshot.entities_of_kind(kind).cloned().collect();

    if matches.is_empty() {
        empty_note(ui, "None");
        return;
    }

    for entity in matches {
        entity_row(ctx, ui, &entity);
    }
}

/// `sideBarSectionHeader`: 22px, uppercase, with a twisty on the left.
fn section_header(ui: &mut egui::Ui, heading: &str, open: bool) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), metrics::SECTION_HEADER),
        egui::Sense::click(),
    );

    let painter = ui.painter();
    if response.hovered() {
        painter.rect_filled(
            rect,
            0,
            theme::row(ui, theme::RowState::Hover).expect("hover has a ground"),
        );
    }
    painter.hline(rect.x_range(), rect.top(), theme::hairline(ui));

    let twisty = egui::Rect::from_center_size(
        egui::pos2(rect.left() + 11.0, rect.center().y),
        egui::vec2(11.0, 11.0),
    );
    if open {
        icons::chevron_down(painter, twisty, theme::ink(ui, theme::Ink::Normal));
    } else {
        icons::chevron_right(painter, twisty, theme::ink(ui, theme::Ink::Normal));
    }

    let (font, color) = text::section_header_paint(ui);
    painter.text(
        egui::pos2(rect.left() + ROW_INDENT, rect.center().y),
        egui::Align2::LEFT_CENTER,
        heading.to_uppercase(),
        font,
        color,
    );

    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

fn entity_row(ctx: &mut ViewCtx, ui: &mut egui::Ui, entity: &Entity) {
    let selected = ctx.state.route.selected_entity() == Some(&entity.id);
    let badge = row_badge(ctx, ui.visuals().dark_mode, entity);

    let row = Row {
        label: &entity.name,
        indent: ROW_INDENT,
        selected,
        badge,
    };
    let response = list_row(ui, row).on_hover_text(entity.path.as_str());

    if response.clicked() {
        ctx.push(AppCommand::SelectEntity(entity.id.clone()));
    }
}

/// Row indicator priority (specification §11.3): active count, then invalid
/// manifest, then the most recent completed status, then nothing.
fn row_badge(ctx: &ViewCtx, dark: bool, entity: &Entity) -> Option<(String, egui::Color32)> {
    let snapshot = ctx.snapshot;

    let active = match entity.kind {
        EntityKind::Job => snapshot.active_runs_of(&entity.id).count(),
        EntityKind::Bench => snapshot.active_bench_runs_of(&entity.id).count(),
    };
    if active > 0 {
        return Some((
            active.to_string(),
            theme::status_color(dark, RunStatus::Running),
        ));
    }

    if !entity.manifest.is_valid() {
        return Some((
            "Invalid".to_owned(),
            theme::status_color(dark, RunStatus::Failed),
        ));
    }

    let latest = match entity.kind {
        EntityKind::Job => snapshot
            .job_history(&entity.id)
            .next()
            .map(|run| run.status),
        EntityKind::Bench => snapshot
            .bench_history(&entity.id)
            .next()
            .map(|run| run.status),
    }?;

    Some((latest.label().to_owned(), theme::status_color(dark, latest)))
}

// ---------------------------------------------------------------------------
// Active runs view
// ---------------------------------------------------------------------------

/// Everything the user started and that has not finished, top level only.
///
/// A Bench run is listed once, not once per dispatched child — the same rule the
/// header count uses (specification §21).
fn running(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let snapshot = ctx.snapshot;

    let mut rows: Vec<(String, RunStatus, Route)> = Vec::new();

    for bench_run in snapshot
        .bench_runs
        .values()
        .filter(|r| r.status.is_active())
    {
        rows.push((
            snapshot.entity_name(&bench_run.bench_id).to_owned(),
            bench_run.status,
            Route::BenchRunDetail {
                bench_id: bench_run.bench_id.clone(),
                run_id: bench_run.id.clone(),
            },
        ));
    }

    for job_run in snapshot
        .job_runs
        .values()
        .filter(|r| r.status.is_active() && r.origin.is_direct())
    {
        rows.push((
            snapshot.entity_name(&job_run.job_id).to_owned(),
            job_run.status,
            Route::JobRunDetail {
                job_id: job_run.job_id.clone(),
                run_id: job_run.id.clone(),
            },
        ));
    }

    if rows.is_empty() {
        empty_note(ui, "Nothing is running.");
        return;
    }

    ui.add_space(space::SMALL);
    let dark = ui.visuals().dark_mode;
    for (name, status, route) in rows {
        let selected = ctx.state.route == route;
        let row = Row {
            label: &name,
            indent: 12.0,
            selected,
            badge: Some((status.label().to_owned(), theme::status_color(dark, status))),
        };
        let response = list_row(ui, row);
        if response.clicked() {
            ctx.push(AppCommand::Navigate(route));
        }
    }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

fn empty_note(ui: &mut egui::Ui, text: &str) {
    ui.horizontal(|ui| {
        ui.add_space(ROW_INDENT);
        ui.label(crate::ui::text::chrome_note(ui, text));
    });
    ui.add_space(space::SMALL);
}

struct Row<'a> {
    label: &'a str,
    indent: f32,
    selected: bool,
    /// Right-aligned marker text and its colour.
    badge: Option<(String, egui::Color32)>,
}

/// One 22px list row, painted the way VS Code paints tree rows.
///
/// Drawn by hand rather than with [`egui::Button::selectable`] so that the
/// selection fill can be `list.activeSelectionBackground` while text selection
/// elsewhere keeps `editor.selectionBackground`.
fn list_row(ui: &mut egui::Ui, row: Row<'_>) -> egui::Response {
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), metrics::ROW),
        egui::Sense::click(),
    );

    if !ui.is_rect_visible(rect) {
        return response;
    }

    let painter = ui.painter();
    if row.selected {
        painter.rect_filled(
            rect,
            0,
            theme::row(ui, theme::RowState::Selected).expect("selection has a ground"),
        );
        painter.rect_stroke(
            rect.shrink(0.5),
            0,
            egui::Stroke::new(1.0, theme::accent(ui)),
            egui::StrokeKind::Inside,
        );
    } else if response.hovered() {
        painter.rect_filled(
            rect,
            0,
            theme::row(ui, theme::RowState::Hover).expect("hover has a ground"),
        );
    }

    // Lay the badge out first: it decides how much room the label has left.
    let badge = row.badge.map(|(text, color)| {
        let galley = elided(ui, &text, 11.0, color, rect.width() * 0.5);
        (galley, color)
    });
    let badge_width = badge
        .as_ref()
        .map_or(0.0, |(galley, _)| galley.size().x + space::NORMAL);

    let label_color = if row.selected {
        theme::row_ink(ui, theme::RowState::Selected)
    } else {
        theme::row_ink(ui, theme::RowState::Rest)
    };
    let label_width = (rect.width() - row.indent - badge_width - ROW_TRAILING).max(0.0);
    let galley = elided(ui, row.label, 13.0, label_color, label_width);
    ui.painter().galley(
        egui::pos2(
            rect.left() + row.indent,
            rect.center().y - galley.size().y / 2.0,
        ),
        galley,
        label_color,
    );

    if let Some((galley, color)) = badge {
        ui.painter().galley(
            egui::pos2(
                rect.right() - ROW_TRAILING - galley.size().x,
                rect.center().y - galley.size().y / 2.0,
            ),
            galley,
            color,
        );
    }

    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// A single line, truncated with an ellipsis rather than wrapped.
fn elided(
    ui: &egui::Ui,
    text: &str,
    size: f32,
    color: egui::Color32,
    max_width: f32,
) -> Arc<egui::Galley> {
    let mut job = LayoutJob::single_section(
        text.to_owned(),
        TextFormat {
            font_id: egui::FontId::proportional(size),
            color,
            ..Default::default()
        },
    );
    job.wrap = TextWrapping {
        max_width,
        max_rows: 1,
        break_anywhere: true,
        overflow_character: Some('…'),
    };
    ui.painter().layout_job(job)
}
