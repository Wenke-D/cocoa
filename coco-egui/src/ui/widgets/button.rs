//! The workbench's button.
//!
//! There is one shape. Only the fill says how important the action is, which is
//! how VS Code distinguishes its primary and secondary buttons — never by size.
//!
//! It exists as a component rather than a call to [`egui::Ui::button`] because
//! of where a button's label ends up vertically. egui derives a button's frame
//! margin as `button_padding - border_width` and then grows the whole thing to
//! `spacing.interact_size.y`, so a bordered button is always a little shorter
//! than its own minimum and carries leftover space inside its frame. That
//! leftover is handed to the *parent* layout's vertical align — `Align::Center`
//! under [`egui::Ui::horizontal`], but `Align::Min` in the page header rows,
//! where it all collects below the label and the label rides high.
//!
//! Chasing a padding that leaves no space over means re-deriving egui's margin
//! arithmetic and getting it wrong again the next time a border changes. So this
//! pins the alignment instead: whatever space is left over is split evenly,
//! wherever the button is used.

use crate::ui::theme;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// The one action a page or modal exists for. Accent-filled, at most one
    /// per surface.
    Primary,
    /// Everything else.
    Secondary,
}

#[must_use = "a button does nothing until it is shown"]
pub struct Button<'a> {
    label: &'a str,
    kind: Kind,
    enabled: bool,
    fill_width: bool,
}

impl<'a> Button<'a> {
    pub fn primary(label: &'a str) -> Self {
        Self {
            label,
            kind: Kind::Primary,
            enabled: true,
            fill_width: false,
        }
    }

    pub fn secondary(label: &'a str) -> Self {
        Self {
            label,
            kind: Kind::Secondary,
            enabled: true,
            fill_width: false,
        }
    }

    /// A disabled button stays visible and keeps its place; it explains itself
    /// through the tooltip its caller attaches (specification §36).
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// Span the available width, for choices stacked one per row.
    pub fn fill_width(mut self) -> Self {
        self.fill_width = true;
        self
    }

    pub fn show(self, ui: &mut egui::Ui) -> egui::Response {
        let mut button = match self.kind {
            // The border matches the fill, so a primary button occupies exactly
            // the same box as a secondary one.
            Kind::Primary => {
                // A primary button states its own fill, which would otherwise
                // override the dimming egui gives a disabled widget and leave
                // an unavailable action looking exactly like an available one.
                let (fill, label) = if self.enabled {
                    (theme::accent(ui), theme::ink(ui, theme::Ink::OnAccent))
                } else {
                    // A washed-out accent with a washed-out label on top is
                    // unreadable in the light theme, so the disabled state drops
                    // the accent entirely and reads as a muted control instead.
                    (
                        theme::control(ui, theme::ControlState::Rest),
                        theme::ink(ui, theme::Ink::Normal).gamma_multiply(0.5),
                    )
                };
                egui::Button::new(egui::RichText::new(self.label).color(label))
                    .fill(fill)
                    .stroke(egui::Stroke::new(1.0, fill))
            }
            Kind::Secondary => egui::Button::new(self.label),
        };
        button = button.corner_radius(egui::CornerRadius::same(2));
        if self.fill_width {
            button = button.min_size(egui::vec2(ui.available_width(), 0.0));
        }

        // Centre the label, and change nothing else.
        //
        // The region is exactly one control tall, so "centred" means centred in
        // the button and not in whatever taller row surrounds it — a page header
        // is three lines high, and centring in *that* would drop the action away
        // from the title it belongs to. Placement of the region itself still
        // follows the surrounding layout, so the header's action stays pinned to
        // the top right.
        let height = ui.spacing().interact_size.y;
        let layout = ui.layout().with_cross_align(egui::Align::Center);

        ui.allocate_ui_with_layout(egui::vec2(ui.available_width(), height), layout, |ui| {
            ui.add_enabled(self.enabled, button)
        })
        .inner
    }
}
