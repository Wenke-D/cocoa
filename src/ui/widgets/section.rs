//! A titled block of content.
//!
//! Pages and modals were each spelling this out: a small heading, sometimes a
//! rule under it, sometimes a note beside it, sometimes one action at the right,
//! then whatever spacing the author remembered. The shape is the same
//! everywhere, so it is stated once here and the spacing stops being a matter
//! of memory.
//!
//! ```ignore
//! Section::new("ACTIVE RUNS").show(ui, |ui| { ... });
//!
//! let done = Section::new("PARAMETERS")
//!     .note("(all required)")
//!     .rule(false)
//!     .action("Fill from last run", icons::history)
//!     .show(ui, |ui| { ... });
//! if done.action_clicked { ... }
//! ```

use crate::ui::widgets::icon_button;
use crate::ui::{space, text};

/// What a drawn section reports back: whatever the body returned, plus whether
/// the section's own action was pressed.
pub struct SectionOutput<R> {
    pub inner: R,
    pub action_clicked: bool,
}

#[must_use = "a section does nothing until it is shown"]
pub struct Section<'a> {
    title: &'a str,
    note: Option<&'a str>,
    rule: bool,
    action: Option<Action<'a>>,
    enabled: bool,
}

struct Action<'a> {
    tooltip: &'a str,
    paint: fn(&egui::Painter, egui::Rect, egui::Color32),
}

impl<'a> Section<'a> {
    pub fn new(title: &'a str) -> Self {
        Self {
            title,
            note: None,
            rule: true,
            action: None,
            enabled: true,
        }
    }

    /// A qualifier shown beside the title, e.g. `(all required)`.
    pub fn note(mut self, note: &'a str) -> Self {
        self.note = Some(note);
        self
    }

    /// The rule under the heading. On by default; a modal's sections are close
    /// enough together that a rule reads as clutter rather than structure.
    pub fn rule(mut self, rule: bool) -> Self {
        self.rule = rule;
        self
    }

    /// One icon action at the section's right edge, as the sidebar's title row
    /// carries its own.
    pub fn action(
        mut self,
        tooltip: &'a str,
        paint: fn(&egui::Painter, egui::Rect, egui::Color32),
    ) -> Self {
        self.action = Some(Action { tooltip, paint });
        self
    }

    /// The action, but only when it applies. A section's action is often
    /// conditional — there is no history to fill from before the first run.
    pub fn action_if(
        self,
        present: bool,
        tooltip: &'a str,
        paint: fn(&egui::Painter, egui::Rect, egui::Color32),
    ) -> Self {
        if present {
            self.action(tooltip, paint)
        } else {
            self
        }
    }

    /// Greys the action out, for a section whose content is mid-submission.
    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    /// Draws the heading alone and reports whether its action was pressed; the
    /// body then follows in the caller's own flow.
    ///
    /// A detail page is a long run of sections, and wrapping each one in a
    /// closure would indent the whole page for no gain. Use [`Self::show`]
    /// where the body is short enough that keeping it with its heading helps.
    pub fn show_heading(self, ui: &mut egui::Ui) -> bool {
        let mut action_clicked = false;

        ui.horizontal(|ui| {
            ui.label(text::section(self.title));
            if let Some(note) = self.note {
                ui.label(text::caption(note));
            }
            if let Some(action) = self.action {
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    action_clicked = ui
                        .add_enabled_ui(self.enabled, |ui| {
                            icon_button(ui, action.tooltip, action.paint)
                        })
                        .inner
                        .clicked();
                });
            }
        });

        if self.rule {
            ui.add_space(space::SMALL);
            ui.separator();
        }
        ui.add_space(space::NORMAL);

        action_clicked
    }

    /// Draws the heading and the body that belongs to it.
    pub fn show<R>(
        self,
        ui: &mut egui::Ui,
        contents: impl FnOnce(&mut egui::Ui) -> R,
    ) -> SectionOutput<R> {
        let action_clicked = self.show_heading(ui);
        SectionOutput {
            inner: contents(ui),
            action_clicked,
        }
    }
}
