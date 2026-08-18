//! The Bench progress bar.
//!
//! One definition, shared by the active-run card and the run-detail page, so a
//! Bench's progress reads the same wherever it is shown.
//!
//! Progress here is not a continuous quantity. A Bench dispatches a fixed list
//! of calls and each one is either finished or not, so the bar is one segment
//! per call rather than a sliding fill — and since the segments are already
//! there, each is coloured by the outcome of the call it stands for. That says
//! everything the counts line says, in the order the plan listed them, and shows
//! at a glance whether the failures are clustered or scattered.
//!
//! Colour is never the only signal (specification §23): the counts line beside
//! the bar carries the same information in words.
//!
//! Painted rather than built from [`egui::ProgressBar`], which is continuous by
//! construction and takes its fill from `selection.bg_fill` and its track from
//! `extreme_bg_color` — the editor's *text selection* colour and the *text
//! field* background. On the light theme that is a pale blue bar on a white
//! track, and the track is the same white as the page behind it.

use crate::model::RunStatus;
use crate::ui::theme;

/// Thin enough to read as a rule under the counts rather than as a widget
/// competing with them.
const HEIGHT: f32 = 6.0;
const RADIUS: u8 = 2;
/// Space between segments, and the narrowest a segment may get before it is
/// spent. A fifty-call sweep would otherwise be more gap than bar.
const GAP: f32 = 2.0;
const MIN_SEGMENT: f32 = 6.0;

/// `statuses` is the outcome of every dispatched call, in plan order.
pub fn bar(ui: &mut egui::Ui, statuses: &[RunStatus]) {
    let (rect, _) = ui.allocate_exact_size(
        egui::vec2(ui.available_width(), HEIGHT),
        egui::Sense::hover(),
    );

    if !ui.is_rect_visible(rect) {
        return;
    }

    let painter = ui.painter();

    // A plan with no calls still shows its empty track rather than nothing.
    if statuses.is_empty() {
        painter.rect_filled(rect, RADIUS, theme::control(ui, theme::ControlState::Rest));
        return;
    }

    let dark = ui.visuals().dark_mode;
    let count = statuses.len() as f32;
    let gap = if rect.width() / count > MIN_SEGMENT {
        GAP
    } else {
        0.0
    };

    for (index, status) in statuses.iter().enumerate() {
        let left = rect.left() + rect.width() * index as f32 / count;
        let right = rect.left() + rect.width() * (index + 1) as f32 / count - gap;

        painter.rect_filled(
            egui::Rect::from_min_max(
                egui::pos2(left, rect.top()),
                // Never let a segment collapse to nothing, however many there
                // are: an invisible call is worse than a cramped one.
                egui::pos2(right.max(left + 1.0), rect.bottom()),
            ),
            RADIUS,
            theme::status_color(dark, *status),
        );
    }
}
