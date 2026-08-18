//! The type scale.
//!
//! Every text role the workbench uses is named here, rather than respelled as a
//! chain of egui modifiers at each call site. There were 67 of those chains
//! before this module existed, and `.small().strong().weak()` appearing in
//! three files is three chances to get it subtly different.
//!
//! Roles are named for what the text *is*, not for how it looks, so that
//! changing how a role looks is one edit here. Two roles that render the same
//! today still get separate names when they mean different things — an eyebrow
//! and a section label are the same size now and need not stay that way.

use egui::RichText;

use crate::model::DisplayStatus;
use crate::ui::theme;

/// The size VS Code gives the workbench's own chrome: panel titles, section
/// twisties, the notes beside them. Distinct from the content type scale, and
/// spelled once here rather than as a bare `11.0` at each painter.
const CHROME_SIZE: f32 = 11.0;

/// The small type label above a title: `JOB`, `START BENCH`.
pub fn eyebrow(text: impl Into<String>) -> RichText {
    RichText::new(text).small().strong().weak()
}

/// A section's heading: `ACTIVE RUNS`, `PARAMETERS`.
pub fn section(text: impl Into<String>) -> RichText {
    RichText::new(text).small().strong().weak()
}

/// Secondary explanation: hints, notes, and anything the reader may skip.
pub fn caption(text: impl Into<String>) -> RichText {
    RichText::new(text).weak().small()
}

/// A quiet line at body size, e.g. an empty-state note.
pub fn muted(text: impl Into<String>) -> RichText {
    RichText::new(text).weak()
}

/// The one line in a block that carries its identity.
pub fn strong(text: impl Into<String>) -> RichText {
    RichText::new(text).strong()
}

/// Values the user may want to copy: parameters, paths, run ids.
pub fn mono(text: impl Into<String>) -> RichText {
    RichText::new(text).monospace()
}

/// A monospace value in a supporting role, e.g. a field's name.
pub fn mono_muted(text: impl Into<String>) -> RichText {
    RichText::new(text).monospace().weak()
}

/// A panel or menu title: `LIBRARY`, `BENCHES`, `Color Theme`.
///
/// Louder than [`section`], which labels content inside the editor — VS Code's
/// side bar titles carry the full foreground, while a label inside a document
/// steps back from the content it introduces.
pub fn panel_header(ui: &egui::Ui, text: &str) -> RichText {
    RichText::new(text.to_uppercase())
        .size(CHROME_SIZE)
        .strong()
        .color(theme::ink(ui, theme::Ink::Strong))
}

/// [`panel_header`] as the font and colour a painter needs.
///
/// A view header allocates its own rect and paints into it, so it cannot take a
/// `RichText`; it takes the same decision in the form it can use.
pub fn panel_header_paint(ui: &egui::Ui) -> (egui::FontId, egui::Color32) {
    (
        egui::FontId::proportional(CHROME_SIZE),
        theme::ink(ui, theme::Ink::Strong),
    )
}

/// A quiet line in the chrome, e.g. an empty section in the sidebar.
pub fn chrome_note(ui: &egui::Ui, text: &str) -> RichText {
    RichText::new(text)
        .size(CHROME_SIZE)
        .color(theme::ink(ui, theme::Ink::Muted))
}

/// A run's status, in the colour that status owns.
///
/// The label and the colour are chosen together, so no call site can pair
/// `Succeeded` with the colour of `Failed`. Colour is never the only signal —
/// the label is always present (specification §23).
pub fn status(ui: &egui::Ui, display: DisplayStatus) -> RichText {
    let style = theme::status_style(ui.visuals().dark_mode, display);
    RichText::new(display.label()).color(style.color)
}

/// [`status`] with the emphasis a header pill wants.
pub fn status_strong(ui: &egui::Ui, display: DisplayStatus) -> RichText {
    status(ui, display).strong()
}

/// A table's column header. Stronger than a section label and not weakened:
/// it sits directly above the values it names.
pub fn table_header(text: impl Into<String>) -> RichText {
    RichText::new(text).small().strong()
}

/// The em dash a cell shows when a value does not apply. Named because "no
/// value" is a decision, not a punctuation choice each table makes for itself.
pub fn none() -> RichText {
    muted("—")
}

/// Something the reader should notice but that is not a failure.
pub fn warning(ui: &egui::Ui, text: impl Into<String>) -> RichText {
    RichText::new(text).color(ui.visuals().warn_fg_color)
}

/// Failure text. Takes the `Ui` because the colour comes from the live visuals,
/// which follow the user's light/dark choice.
pub fn error(ui: &egui::Ui, text: impl Into<String>) -> RichText {
    RichText::new(text).color(ui.visuals().error_fg_color)
}
