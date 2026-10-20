/// The manual for agents: one page in the repository that points at the
/// rest. Linked, not baked in — it is versioned and reviewed beside the code
/// that enforces it, and a copy in this binary would hand agents whichever
/// revision they happened to have installed.
pub(crate) const MANUAL: &str = "https://github.com/Wenke-D/cocoa/blob/main/manual.ai.md";
pub(crate) const MANUAL_RAW: &str =
    "https://raw.githubusercontent.com/Wenke-D/cocoa/main/manual.ai.md";

/// What `--help-ai` prints: a pointer, not a document.
pub(crate) fn help_ai() -> String {
    format!(
        "\
cocoa runs experiment folders: jobs (one start = one submission) and campaigns \
(a plan fans out over registered jobs). How an agent works with it — the rules, \
how to write an experiment's scripts, what a report should say — starts at:

  {MANUAL}
  (raw: {MANUAL_RAW})

Live state — registered experiments, their parameters, runs, reports — comes \
from this server's MCP tools (start with cocoa_help), not from the document.
"
    )
}
