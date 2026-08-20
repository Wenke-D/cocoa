//! Bottom status bar, styled as VS Code's status bar.
//!
//! Three standing items and two conditional ones (specification §8.5): how many
//! runs are active, how long ago the engine was last read, and a button to read
//! it again; then the query-interruption warning and the transient message, each
//! shown only when it applies. Never verbose logs.
//!
//! The transient message is the only place a failed Refresh or Cancel can report
//! itself.

use crate::app::{AppCommand, ViewCtx};
use crate::ui::icons;
use crate::ui::theme::{self, metrics};
use crate::view_model::format_relative;

/// Horizontal padding inside one status bar item.
const PADDING: f32 = 6.0;

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let snapshot = ctx.snapshot;
    let now = ctx.now;

    let active = snapshot.active_run_count();
    let last_refresh = snapshot
        .last_refresh
        .map(|at| format_relative(at, now))
        .unwrap_or_else(|| "—".to_owned());
    let interrupted = snapshot.has_query_interruption();
    let message = ctx.state.transient_message.clone();

    egui::Panel::bottom("status_bar")
        .exact_size(metrics::STATUS_BAR)
        .resizable(false)
        .frame(theme::status_bar_frame(ui))
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing = egui::Vec2::ZERO;

            ui.horizontal_centered(|ui| {
                item(ui, "active", None, &active_label(active));

                item(
                    ui,
                    "last_refresh",
                    None,
                    &format!("Last refresh {last_refresh}"),
                );

                // The one action here, so it is an icon rather than a word.
                if icon_item(ui, "refresh", Icon::Sync)
                    .on_hover_text("Refresh now")
                    .clicked()
                {
                    ctx.push(AppCommand::Refresh);
                }

                if interrupted {
                    item(
                        ui,
                        "interrupted",
                        Some(Icon::Warning),
                        "Some runs cannot be queried",
                    )
                    .on_hover_text("A run's status could not be read. It is still executing.");
                }

                if let Some(message) = message {
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if item(ui, "dismiss", None, "Dismiss").clicked() {
                            ctx.state.transient_message = None;
                        }
                        let icon = message.is_error.then_some(Icon::Error);
                        item(ui, "message", icon, &message.text);
                    });
                }
            });
        });
}

fn active_label(active: usize) -> String {
    match active {
        0 => "No active runs".to_owned(),
        1 => "1 active run".to_owned(),
        n => format!("{n} active runs"),
    }
}

enum Icon {
    Sync,
    Warning,
    Error,
}

impl Icon {
    fn color(&self, ui: &egui::Ui) -> egui::Color32 {
        match self {
            Self::Sync => theme::ink(ui, theme::Ink::Normal),
            Self::Warning => theme::feedback(ui, theme::Level::Warning),
            Self::Error => theme::feedback(ui, theme::Level::Error),
        }
    }

    fn paint(&self, painter: &egui::Painter, rect: egui::Rect, color: egui::Color32) {
        match self {
            Self::Sync => icons::sync(painter, rect, color),
            Self::Warning => icons::warning(painter, rect, color),
            Self::Error => icons::error(painter, rect, color),
        }
    }
}

/// A square, icon-only status bar item.
fn icon_item(ui: &mut egui::Ui, id: &str, icon: Icon) -> egui::Response {
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(metrics::STATUS_BAR, metrics::STATUS_BAR),
        egui::Sense::hover(),
    );
    let response = ui.interact(rect, ui.id().with(id), egui::Sense::click());

    let painter = ui.painter();
    if response.hovered() {
        painter.rect_filled(rect, 0, theme::status_bar_hover(ui));
    }
    icon.paint(
        painter,
        egui::Rect::from_center_size(rect.center(), egui::vec2(12.0, 12.0)),
        icon.color(ui),
    );

    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// One hoverable status bar item, optionally led by an icon.
fn item(ui: &mut egui::Ui, id: &str, icon: Option<Icon>, text: &str) -> egui::Response {
    let font = egui::FontId::proportional(11.0);
    let icon_width = if icon.is_some() { 16.0 } else { 0.0 };
    let width = text_width(ui, text, &font) + icon_width + PADDING * 2.0;

    let (rect, _) =
        ui.allocate_exact_size(egui::vec2(width, metrics::STATUS_BAR), egui::Sense::hover());
    // Interact under an explicit id: several items share the same shape, and a
    // rect-derived id would collide between them.
    let response = ui.interact(rect, ui.id().with(id), egui::Sense::click());

    let painter = ui.painter();
    if response.hovered() {
        // `statusBarItem.hoverBackground`, which is a translucent wash.
        painter.rect_filled(rect, 0, theme::status_bar_hover(ui));
    }

    let color = icon
        .as_ref()
        .map_or(theme::ink(ui, theme::Ink::Normal), |icon| icon.color(ui));

    if let Some(icon) = &icon {
        icon.paint(
            painter,
            egui::Rect::from_center_size(
                egui::pos2(rect.left() + PADDING + 6.0, rect.center().y),
                egui::vec2(12.0, 12.0),
            ),
            color,
        );
    }

    painter.text(
        egui::pos2(rect.left() + PADDING + icon_width, rect.center().y),
        egui::Align2::LEFT_CENTER,
        text,
        font,
        color,
    );

    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

fn text_width(ui: &egui::Ui, text: &str, font: &egui::FontId) -> f32 {
    ui.painter()
        .layout_no_wrap(text.to_owned(), font.clone(), egui::Color32::PLACEHOLDER)
        .size()
        .x
}
