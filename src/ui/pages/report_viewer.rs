//! Report viewer (specification §20).
//!
//! Opens full-width in the main content region — never in a tooltip, a narrow
//! panel, or a small modal (specification §7.4).
//!
//! Two presentations, chosen by [`ReportFormat`]:
//!
//! * **Plain text** is rendered here: monospace, selectable, searchable, with a
//!   wrap toggle and virtualised rows so a several-thousand-line trace stays
//!   responsive.
//! * **HTML** is handed to the system browser. The application does not control
//!   report styling — every experiment writes whatever it writes — so any
//!   in-app approximation would misrepresent the report. The page still shows
//!   the report's identity, offers the source for search and copy, and makes
//!   opening it the primary action.

use std::sync::Arc;

use crate::app::{AppCommand, ViewCtx};
use crate::navigation::ReportContext;
use crate::ui::icons;
use crate::ui::widgets::breadcrumbs;
use crate::ui::widgets::button::Button;
use crate::ui::widgets::icon_button;
use crate::ui::widgets::section::Section;
use crate::ui::{space, text};
use crate::view_model::{ReportFormat, ReportState, RunId};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui, context: &ReportContext, run_id: &RunId) {
    breadcrumbs::show(ctx, ui);

    let Some(state) = lookup(ctx, context, run_id) else {
        return;
    };

    match &state {
        ReportState::Available { format, text } => {
            header(ctx, ui, context, run_id, *format, text);
            ui.add_space(space::SECTION);

            match format {
                ReportFormat::PlainText => text_body(ctx, ui, text),
                ReportFormat::Html => html_body(ctx, ui, run_id, text),
            }
        }

        ReportState::ReadError { message } => {
            ui.heading("Report");
            ui.add_space(space::SECTION);
            notice(ui, ui.visuals().error_fg_color, |ui| {
                ui.label(text::strong("Unable to read report."));
                ui.add_space(space::NORMAL);
                ui.label(message);
            });
        }

        other => {
            ui.heading("Report");
            ui.add_space(space::SECTION);
            ui.label(text::muted(other.summary()));
        }
    }
}

/// A report belongs to a Bench run only in the `BenchRun` context; every other
/// context addresses a Job run.
fn lookup(ctx: &ViewCtx, context: &ReportContext, run_id: &RunId) -> Option<ReportState> {
    match context {
        ReportContext::BenchRun { .. } => {
            ctx.snapshot.bench_run(run_id).map(|run| run.report.clone())
        }
        _ => ctx.snapshot.job_run(run_id).map(|run| run.report.clone()),
    }
}

fn header(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    context: &ReportContext,
    run_id: &RunId,
    format: ReportFormat,
    text: &Arc<str>,
) {
    let title = match context {
        ReportContext::BenchRun { bench_id } => {
            format!("{} — bench report", ctx.snapshot.entity_name(bench_id))
        }
        _ => match ctx.snapshot.job_run(run_id) {
            Some(run) => format!("{} — report", ctx.snapshot.entity_name(&run.job_id)),
            None => "Report".to_owned(),
        },
    };

    let when = ctx
        .snapshot
        .job_run(run_id)
        .map(|run| run.started_at)
        .or_else(|| ctx.snapshot.bench_run(run_id).map(|run| run.started_at));

    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.heading(title);
            let subtitle = match when {
                Some(at) => format!(
                    "{} · Run {} · {}",
                    format.label(),
                    at.format("%Y-%m-%d %H:%M:%S"),
                    run_id
                ),
                None => format!("{} · {run_id}", format.label()),
            };
            ui.label(text::caption(subtitle));
        });

        ui.with_layout(egui::Layout::right_to_left(egui::Align::Min), |ui| {
            if format == ReportFormat::Html
                && Button::secondary("Open in Browser").show(ui).clicked()
            {
                ctx.push(AppCommand::OpenReportExternally(run_id.clone()));
            }

            if Button::secondary("Copy").show(ui).clicked() {
                ui.ctx().copy_text(text.to_string());
                ctx.push(AppCommand::Notify("Report copied.".to_owned()));
            }

            if format == ReportFormat::PlainText {
                let mut wrap = ctx.state.report_wrap_lines;
                if ui.checkbox(&mut wrap, "Wrap Lines").changed() {
                    ctx.state.report_wrap_lines = wrap;
                }
            }
        });
    });
}

// ------------------------------------------------------------------ plain text

fn text_body(ctx: &mut ViewCtx, ui: &mut egui::Ui, text: &Arc<str>) {
    let lines: Vec<&str> = text.lines().collect();
    let needle = ctx.state.report_search.trim().to_lowercase();

    // Match counting is required; visual highlighting is a bonus
    // (specification §20.2).
    let matches: Vec<usize> = if needle.is_empty() {
        Vec::new()
    } else {
        lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.to_lowercase().contains(&needle))
            .map(|(index, _)| index)
            .collect()
    };

    let mut scroll_to: Option<usize> = None;
    search_controls(ctx, ui, &matches, &mut scroll_to);
    ui.add_space(space::NORMAL);

    // Both modes draw the same row, at the same pitch. `item_spacing` is zeroed
    // because `show_rows` would add it on top of the height it is given, while a
    // wrapped row has nothing between its lines at all — all the air comes from
    // `line_pitch` instead, which reaches inside the galley too.
    let row_height = line_pitch(ui);
    ui.spacing_mut().item_spacing.y = 0.0;

    // The line the "current match" indicator sits on, and the line the user
    // just stepped to, if any.
    let current_line = matches.get(ctx.state.report_match_index).copied();
    let target_line = scroll_to.and_then(|index| matches.get(index).copied());

    if ctx.state.report_wrap_lines {
        // A wrapped row is as tall as it needs to be, so rows cannot be found
        // by index and the whole body is laid out. That is also why the scroll
        // target has to ask its own row to come into view instead of being
        // computed. Wrapping is off by default for exactly this reason.
        egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for (index, line) in lines.iter().enumerate() {
                    let row = line_row(
                        ui,
                        line,
                        &needle,
                        Some(index) == current_line,
                        egui::TextWrapMode::Wrap,
                    );
                    if Some(index) == target_line {
                        row.scroll_to_me(Some(egui::Align::Center));
                    }
                }
            });
        return;
    }

    // Unwrapped rows are uniform, so only the visible ones are laid out — that
    // is what keeps a several-thousand-line report responsive (§35) — and the
    // scroll target is an offset, which works whether or not its row is one of
    // the rows currently on screen.
    let mut area = egui::ScrollArea::both().auto_shrink([false, false]);
    if let Some(target) = target_line {
        area = area.vertical_scroll_offset((target as f32 * row_height - 80.0).max(0.0));
    }

    area.show_rows(ui, row_height, lines.len(), |ui, range| {
        for index in range {
            line_row(
                ui,
                lines[index],
                &needle,
                Some(index) == current_line,
                egui::TextWrapMode::Extend,
            );
        }
    });
}

/// Line pitch in the report body, as a multiple of the font's own row height.
///
/// Reports are read for minutes at a time, so the rows are worth the air. This
/// is applied through [`egui::TextFormat::line_height`] rather than as spacing
/// between widgets, so that a wrapped line's continuation rows — which live
/// inside a single galley, where no widget spacing can reach — are set just as
/// loosely as the lines around them.
const LINE_HEIGHT: f32 = 1.35;

fn line_pitch(ui: &egui::Ui) -> f32 {
    ui.text_style_height(&egui::TextStyle::Monospace) * LINE_HEIGHT
}

/// One line of the report.
///
/// The only thing either mode varies is `wrap`: the font, the highlighting, and
/// the selectability are the same row either way, which is what makes search
/// work identically whether or not lines are wrapped.
fn line_row(
    ui: &mut egui::Ui,
    line: &str,
    needle: &str,
    is_current: bool,
    wrap: egui::TextWrapMode,
) -> egui::Response {
    let highlight = crate::ui::theme::highlight(
        ui,
        if is_current {
            crate::ui::theme::Highlight::Selection
        } else {
            crate::ui::theme::Highlight::FindMatch
        },
    );

    let monospace =
        egui::FontId::monospace(ui.style().text_styles[&egui::TextStyle::Monospace].size);
    let mut job = egui::text::LayoutJob::default();

    // A line with no match is the same line with no highlighted spans, so there
    // is no separate path for it.
    let lowered = line.to_lowercase();
    let mut cursor = 0;
    if !needle.is_empty() {
        while let Some(found) = lowered[cursor..].find(needle) {
            let start = cursor + found;
            let end = start + needle.len();

            append(&mut job, &line[cursor..start], &monospace, ui, None);
            append(&mut job, &line[start..end], &monospace, ui, Some(highlight));
            cursor = end;
        }
    }
    append(&mut job, &line[cursor..], &monospace, ui, None);

    ui.add(egui::Label::new(job).selectable(true).wrap_mode(wrap))
}

fn append(
    job: &mut egui::text::LayoutJob,
    text: &str,
    font: &egui::FontId,
    ui: &egui::Ui,
    background: Option<egui::Color32>,
) {
    // An empty line still occupies a row, so a job with nothing in it yet must
    // take the empty section rather than end up with no sections at all.
    if text.is_empty() && !job.sections.is_empty() {
        return;
    }
    job.append(
        text,
        0.0,
        egui::TextFormat {
            font_id: font.clone(),
            color: ui.visuals().text_color(),
            background: background.unwrap_or(egui::Color32::TRANSPARENT),
            line_height: Some(line_pitch(ui)),
            ..Default::default()
        },
    );
}

fn search_controls(
    ctx: &mut ViewCtx,
    ui: &mut egui::Ui,
    matches: &[usize],
    scroll_to: &mut Option<usize>,
) {
    ui.horizontal(|ui| {
        let field = ui.add(
            egui::TextEdit::singleline(&mut ctx.state.report_search)
                .hint_text("Search report")
                .desired_width(260.0),
        );
        // Focused only when explicitly invoked (specification §25).
        if std::mem::take(&mut ctx.state.focus_report_search) {
            field.request_focus();
        }
        if field.changed() {
            ctx.state.report_match_index = 0;
        }

        if ctx.state.report_search.trim().is_empty() {
            return;
        }

        ui.add_space(space::NORMAL);

        if matches.is_empty() {
            ui.label(text::muted("No matches"));
            return;
        }

        let index = ctx.state.report_match_index.min(matches.len() - 1);
        ctx.state.report_match_index = index;

        if icon_button(ui, "Previous match", icons::chevron_left).clicked() {
            ctx.state.report_match_index = if index == 0 {
                matches.len() - 1
            } else {
                index - 1
            };
            *scroll_to = Some(ctx.state.report_match_index);
        }
        if icon_button(ui, "Next match", icons::chevron_right).clicked() {
            ctx.state.report_match_index = (index + 1) % matches.len();
            *scroll_to = Some(ctx.state.report_match_index);
        }

        ui.label(text::muted(format!(
            "{} of {} matching lines",
            index + 1,
            matches.len()
        )));
    });
}

// ------------------------------------------------------------------------ HTML

fn html_body(ctx: &mut ViewCtx, ui: &mut egui::Ui, run_id: &RunId, text: &Arc<str>) {
    notice(ui, ui.visuals().hyperlink_color, |ui| {
        ui.label(text::strong("This report is HTML."));
        ui.add_space(space::NORMAL);
        ui.label(
            "Reports bring their own styling, and this application does not control it. \
             Opening the report in your browser is the only way to see it as the \
             experiment wrote it.",
        );
        ui.add_space(space::SECTION);
        if Button::secondary("Open in Browser").show(ui).clicked() {
            ctx.push(AppCommand::OpenReportExternally(run_id.clone()));
        }
    });

    ui.add_space(space::PAGE);

    // The source is still searchable and copyable here, so the page is useful
    // without leaving the application.
    let mut show_source = ctx.state.report_show_source;
    if ui.checkbox(&mut show_source, "Show source").changed() {
        ctx.state.report_show_source = show_source;
    }

    if show_source {
        ui.add_space(space::NORMAL);
        Section::new("SOURCE").show_heading(ui);
        text_body(ctx, ui, text);
    }
}

fn notice(ui: &mut egui::Ui, accent: egui::Color32, contents: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::new()
        .fill(accent.gamma_multiply(0.10))
        .stroke(egui::Stroke::new(1.0, accent.gamma_multiply(0.5)))
        .inner_margin(egui::Margin::same(12))
        .corner_radius(4)
        .show(ui, contents);
}
