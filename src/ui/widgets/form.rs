//! Label-and-value rows on a shared column.
//!
//! Three surfaces were each building this out of a bare `egui::Grid`: the run
//! overview's facts, the bench run's facts, and the start modal's inputs. The
//! grid is the easy part — what was being retyped is the decision that a label
//! is muted, that the columns are spaced *this* far apart, and that a row ends
//! where it ends.
//!
//! ```ignore
//! form::grid(ui, "run_overview", |form| {
//!     form.row("Run ID", |ui| parameter_block::inline(ui, run.id.as_str()));
//!     form.row("Started", |ui| { ui.label(started); });
//! });
//! ```

use crate::ui::{space, text};

/// How far a value sits from its label.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gap {
    /// Facts being read down a page, where the eye needs the separation.
    Wide,
    /// Inputs in a modal, where the label belongs to the field beside it.
    Tight,
}

impl Gap {
    fn spacing(self) -> [f32; 2] {
        match self {
            Self::Wide => [space::PAGE, space::NORMAL],
            Self::Tight => [space::NORMAL, space::SMALL],
        }
    }
}

/// The handle a form body uses to add rows.
pub struct Form<'ui> {
    ui: &'ui mut egui::Ui,
    mono_labels: bool,
}

impl Form<'_> {
    /// One labelled row. The label is muted; the value draws itself.
    pub fn row(&mut self, label: &str, value: impl FnOnce(&mut egui::Ui)) {
        let text = if self.mono_labels {
            text::mono_muted(label)
        } else {
            text::muted(label)
        };
        self.ui.label(text);
        value(self.ui);
        self.ui.end_row();
    }

    /// The row's `Ui`, for a value that needs to allocate the width itself.
    pub fn ui(&mut self) -> &mut egui::Ui {
        self.ui
    }
}

/// A form of facts: prose labels, page spacing.
pub fn grid<R>(ui: &mut egui::Ui, id: &str, body: impl FnOnce(&mut Form) -> R) -> R {
    build(ui, id, Gap::Wide, false, body)
}

/// A form of inputs: monospace labels naming declared parameters, modal
/// spacing.
pub fn fields<R>(ui: &mut egui::Ui, id: &str, body: impl FnOnce(&mut Form) -> R) -> R {
    build(ui, id, Gap::Tight, true, body)
}

fn build<R>(
    ui: &mut egui::Ui,
    id: &str,
    gap: Gap,
    mono_labels: bool,
    body: impl FnOnce(&mut Form) -> R,
) -> R {
    egui::Grid::new(id)
        .num_columns(2)
        .spacing(gap.spacing())
        .show(ui, |ui| {
            let mut form = Form { ui, mono_labels };
            body(&mut form)
        })
        .inner
}
