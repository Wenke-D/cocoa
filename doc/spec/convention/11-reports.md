# 11. Reports

On the healthy path, report progress is part of the status axis, not a second
one: `COMPLETED` → `ANALYZING` → `SUCCEEDED` *is* the report lifecycle, and a
report script that fails leaves the run at `ERROR` with its output attached.
That `ERROR` is the one healable case: fixing the script and re-running report
by hand moves the run to `SUCCEEDED` — the cluster had already said
`COMPLETED`, and `SUCCEEDED` is cocoa's word for finished *and* reported
(§7.3).

The one report off that axis is a `FAILED` run's. Its status is already
terminal and is the cluster's to set, so its report keeps its own state —
owed, landed, failed — in the record's `report` field (§7.3.1).

A report is `report/<run_id>.txt`, `report/<run_id>.html`, or both. It has
landed when at least one of the two is on disk; a script that writes neither
has failed, however it exited.

It follows that:

- a succeeded run always has a report: its `.txt`, its `.html`, or both;
- a `FAILED` run has one once its report has landed — not while it is owed,
  not when its script failed, and not if it was `FAILED` before 2026-10-06
  until someone reports it by hand;
- a `CANCELLED` or `ERROR` run has no report;
- `runs/<run_id>/report/attachment/` exists only when the last report
  attached something (§7.3).

## 11.1 Which format, for what

The two formats are for two kinds of reading, and the run's page treats them
so (screens §17.5):

- **Plain text is the quick answer** — a verdict, a few numbers, what someone
  checks at a glance. It is shown on the run's page as it is, with no page to
  open in between; past a dozen lines or so it scrolls inside its box, so keep
  it short.
- **HTML is the long read** — the analysis, its tables and plots, what someone
  sits down with. It is one button away: `Open` shows it in the app's report
  viewer (screens §20), rendered in a sandboxed frame, its source one click
  further for search and copy.
- **Both**: the text is the verdict — did the checks pass, is the number
  within bounds — and the HTML is the reading behind it. The text is on the
  page, `Open` beside it.

A report that only has something to say at length can be HTML alone; one
with nothing to say at length, text alone.

Attachments are any kind of file, so they are the system file manager's to
show: the UI offers to open their directory there. It also offers to save a
copy of a run's report, files and attachments, into a new folder the person
picks, outside cocoa's reach.

A folder with a `[visualize]` script gets one more action on a reported run:
`Visualize`, which starts that script on it (§7.7, §8.4) — for whatever
looking at a run takes beyond reading.
