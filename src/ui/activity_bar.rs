//! The activity bar (specification §8.2) — VS Code's icon strip on the far left.
//!
//! It selects which view the one sidebar shows. It is chrome, not a second
//! content region: the two persistent regions of §7.2 are still the sidebar and
//! the main content. Clicking the already-open item collapses the sidebar, and
//! picking any other item reopens it.

use crate::app::{SidebarView, ThemePreference, ViewCtx};
use crate::ui::icons;
use crate::ui::text;
use crate::ui::theme::{self, metrics};

pub fn show(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    egui::Panel::left("activity_bar")
        .exact_size(metrics::ACTIVITY_BAR)
        .resizable(false)
        .frame(theme::activity_bar_frame(ui))
        .show(ui, |ui| {
            ui.spacing_mut().item_spacing = egui::Vec2::ZERO;

            ui.with_layout(egui::Layout::top_down(egui::Align::Center), |ui| {
                for view in SidebarView::ALL {
                    item(ctx, ui, view);
                }
            });

            // The gear sits at the foot of the strip, below everything else.
            ui.with_layout(egui::Layout::bottom_up(egui::Align::Center), |ui| {
                settings(ctx, ui);
            });
        });
}

fn item(ctx: &mut ViewCtx, ui: &mut egui::Ui, view: SidebarView) {
    let selected = ctx.state.sidebar_open && ctx.state.sidebar_view == view;

    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), metrics::ACTIVITY_BAR),
        egui::Sense::click(),
    );

    if ui.is_rect_visible(rect) {
        let painter = ui.painter();

        // `activityBar.activeBorder`: a 2px accent rule on the leading edge.
        if selected {
            let edge = egui::Rect::from_min_max(
                rect.left_top(),
                egui::pos2(rect.left() + 2.0, rect.bottom()),
            );
            painter.rect_filled(edge, 0, theme::accent(ui));
        }

        let color = if selected || response.hovered() {
            theme::icon(ui, theme::IconState::Active)
        } else {
            theme::icon(ui, theme::IconState::Rest)
        };
        let box_rect = egui::Rect::from_center_size(rect.center(), egui::vec2(24.0, 24.0));

        match view {
            SidebarView::Library => icons::files(
                painter,
                box_rect,
                color,
                theme::surface(ui, theme::Surface::ActivityBar),
            ),
            SidebarView::Running => icons::play(painter, box_rect, color),
        }

        if view == SidebarView::Running {
            badge(ui, box_rect, ctx.snapshot.active_run_count());
        }
    }

    let response = response
        .on_hover_cursor(egui::CursorIcon::PointingHand)
        .on_hover_text(view.tooltip());

    if response.clicked() {
        if ctx.state.sidebar_view == view {
            ctx.state.sidebar_open = !ctx.state.sidebar_open;
        } else {
            ctx.state.sidebar_view = view;
            ctx.state.sidebar_open = true;
        }
    }
}

/// `activityBarBadge`: the active-run count, as a filled accent disc.
fn badge(ui: &egui::Ui, icon_rect: egui::Rect, count: usize) {
    if count == 0 {
        return;
    }
    let painter = ui.painter();
    let center = icon_rect.right_bottom() + egui::vec2(-1.0, -1.0);

    painter.circle_filled(center, 8.0, theme::accent(ui));
    painter.text(
        center,
        egui::Align2::CENTER_CENTER,
        // A two-digit badge is as much as the disc can hold legibly.
        if count > 99 {
            "99+".to_owned()
        } else {
            count.to_string()
        },
        egui::FontId::proportional(if count > 99 { 8.0 } else { 10.0 }),
        theme::ink(ui, theme::Ink::OnAccent),
    );
}

/// The manage gear. Theme choice only (specification §8.2, §24.3).
fn settings(ctx: &mut ViewCtx, ui: &mut egui::Ui) {
    let (rect, response) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), metrics::ACTIVITY_BAR),
        egui::Sense::click(),
    );

    if ui.is_rect_visible(rect) {
        let color = if response.hovered() {
            theme::icon(ui, theme::IconState::Active)
        } else {
            theme::icon(ui, theme::IconState::Rest)
        };
        icons::gear(
            ui.painter(),
            egui::Rect::from_center_size(rect.center(), egui::vec2(20.0, 20.0)),
            color,
        );
    }

    let response = response
        .on_hover_cursor(egui::CursorIcon::PointingHand)
        .on_hover_text("Manage");

    egui::Popup::menu(&response)
        .align(egui::RectAlign::RIGHT_END)
        .show(|ui| {
            ui.set_min_width(160.0);
            ui.label(text::panel_header(ui, "Color Theme"));

            let current = ctx.state.theme;
            for choice in ThemePreference::ALL {
                if ui
                    .selectable_label(current == choice, choice.label())
                    .clicked()
                {
                    ctx.state.theme = choice;
                    choice.apply(ui.ctx());
                    ui.close();
                }
            }
        });
}
