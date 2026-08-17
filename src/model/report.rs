//! Report state.
//!
//! Report state is independent from execution state (specification §10.5). A
//! failed run may have a report; a succeeded run may temporarily have none.
//!
//! Text is held as `Arc<str>` so that cloning the world never copies a report
//! body (specification §35).

use std::sync::Arc;

/// How a report should be presented.
///
/// The application does not control report styling — each experiment writes
/// whatever it writes, and two reports may look nothing alike. Plain text is
/// rendered in-app; HTML is handed to the system browser, which is the only
/// thing that can render it faithfully.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ReportFormat {
    #[default]
    PlainText,
    Html,
}

impl ReportFormat {
    pub fn label(self) -> &'static str {
        match self {
            Self::PlainText => "Plain text",
            Self::Html => "HTML",
        }
    }

    pub fn file_extension(self) -> &'static str {
        match self {
            Self::PlainText => "txt",
            Self::Html => "html",
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum ReportState {
    /// No report exists and none is expected yet.
    #[default]
    Unavailable,
    /// The backend is producing the report.
    Generating,
    Available {
        format: ReportFormat,
        text: Arc<str>,
    },
    /// The run declared a report, but it is not there.
    Missing,
    ReadError {
        message: String,
    },
}

impl ReportState {
    pub fn available(format: ReportFormat, text: Arc<str>) -> Self {
        Self::Available { format, text }
    }

    pub fn text(&self) -> Option<&Arc<str>> {
        match self {
            Self::Available { text, .. } => Some(text),
            _ => None,
        }
    }

    pub fn format(&self) -> Option<ReportFormat> {
        match self {
            Self::Available { format, .. } => Some(*format),
            _ => None,
        }
    }

    pub fn is_available(&self) -> bool {
        matches!(self, Self::Available { .. })
    }

    /// One-line description for detail pages (specification §17.5).
    pub fn summary(&self) -> String {
        match self {
            Self::Unavailable => "Report is not yet available.".to_owned(),
            Self::Generating => "Report is being generated.".to_owned(),
            Self::Available { format, .. } => format!("{} report is available.", format.label()),
            Self::Missing => "Report is missing.".to_owned(),
            Self::ReadError { message } => format!("Unable to read report: {message}"),
        }
    }
}
