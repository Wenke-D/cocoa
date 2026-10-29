# 17. Job Run-Detail Page

Clicking a Job history row opens a full Job run-detail page in the main region.

## 17.1 Header

The head every run page shares (§18.1, §19), drawn by one component: the
status tile (§23) at the left; over the run id, the kind of run in small
uppercase — `JOB RUN`, `CAMPAIGN RUN`, `JOB RUN · CAMPAIGN CALL`; beside the
id, the status chip; the page's one action at the right. The facts below sit
in a panel, one row per fact, a hairline between rows.

Show:

- Breadcrumbs.
- Job name.
- Human-readable run time.
- Status pill.
- Cancel button only when cancellable.
- An Open button per report file when a report is available (§17.5).
- Optional overflow menu.

Example:

```text
Solver GPU / Run 2026-08-15 10:24

Running                                             Cancel Run
```

## 17.2 Overview Fields

Show:

```text
Run ID
Started
Ended
Duration
Last successful query
Query health
Source
```

`Source` is `Started directly` or a link to the dispatching Campaign run:

```text
Source    Nightly Benchmark · Run 2026-08-15 10:24 · call 4
```

Do not show an end time for an active run.

## 17.3 Arguments

Show the run's complete arguments in a selectable, monospace block, in the
wire form the scripts were given (convention §6), names sorted: `--gpu 0
--profile false --tags a --tags b`. What is read is what ran.

The word is deliberate. A *parameter* is what an experiment declares — a name,
a type, a description (§13.1) — and an *argument* is the value one run was
given for it. The overview lists parameters; a run, and every row of a
history, shows arguments.

Do not truncate parameters on this page.

## 17.4 Status Section

For a normal running state:

```text
Running

The Job is currently being monitored.
Last successful query: 1 second ago.
```

For query failure:

```text
Status unavailable

Last known status: Running
Last successful query: 38 seconds ago.

The application could not retrieve the current status.

Retry Now
```

For execution failure:

```text
Failed

The Job reported a failed execution state.
```

These presentations must be visually distinct.

## 17.5 Report Section

Possible states:

```text
Report is not yet available.
Report is being generated.
┌ PASS  residual 2.1e-07 < tolerance 1e-06 ┐        .txt only
└──────────────────────────────────────────┘
[📖 Open]                                            .html only
┌ PASS  residual 2.1e-07 < tolerance 1e-06 ┐        both
└──────────────────────────────────────────┘
[📖 Open]
Report is missing.
Unable to read report: <message>
Report script failed: <output>
```

A report is `.txt`, `.html`, or both, and each is shown for the reading it is
meant for (convention §11.1). **The plain text is the quick answer, so it is
on this page**: read when the report lands and shown as it is, monospaced, on
code's ground, selectable, held to about a dozen lines and scrolling inside
past that — there is no page to open between a reader and a verdict. **The
HTML is the long read, so it is one button**: `Open`, with a book icon,
tooltip `Open the HTML report`, which shows it in the Report Viewer (§20).
With both, the text is here and `Open` leads the buttons under it. No
sentence says a report is available: the text, or the button, does. A
report that landed again — a regenerate passes through `Generating` — is
read again; an unchanged one is not re-read on every tick. The same row
appears on a Campaign run's page (§18).

When the report attached anything (convention §7.3), an `Attachments`
button with an open-folder icon follows `Open` and opens the
attachment directory in the system file manager; its tooltip counts the
entries. Attachments may be any kind of file and any size, so the app does
not show them itself. The button is absent while the report is `Generating`.

When the run's `visualizable` is true — its job has a `[visualize]` script,
and the run a report that is not `Generating` (convention §7.7) — a
`Visualize` button with a line-chart icon follows. Pressed, it is busy
(`Opening…`) until the script has started, so one click opens one viewer;
the viewer appearing is the answer, and nothing else is said. A refusal, a
script that cannot be started, and a viewer that later exits non-zero are
each a notice in the error voice. A campaign run's Report row has the same
button, for the campaign's own script (convention §8.4).

Where the run has a report, `Save as…` follows, with a save icon. It asks
where in a save dialog, suggesting `<experiment>-run-<id>-report` in the home
directory, and copies the run's report files and attachments into that new
folder at the same relative paths they have in the experiment —
`report/<id>.*` and `runs/<id>/report/attachment/` — so an HTML report's links
into its attachments still resolve. The copy is the person's: a later
regenerate or delete leaves it alone. A name that already exists is refused
rather than written into. Saved, a notice says where; closing the dialog says
nothing. A campaign run's Report row has the same button.

Where the run has a report, or a locked one, a `Lock` toggle follows: `Lock`
with an open padlock while the report is unlocked, `Locked` with a closed one,
pressed, while it is locked (convention §7.3.3). Its tooltip says what the lock
holds back. Locked, `Regenerate` stays in the row but disabled, and so does the
page's `Delete`, each with a tooltip saying to unlock the report first. A
refusal is a notice in the error voice. A campaign run's Report row has the
same toggle, for the campaign's own report.

The row's last action is `Regenerate`, a secondary button with a
counter-clockwise arrow, on every job run whose `report_rerunnable` is true —
`Succeeded`, `Failed`, an `Error` its report left, a `Completed` one not yet
taken — and absent otherwise, including while the report is `Generating`.
It asks nothing first: a re-run only replaces a file the script will write
again. Pressed, it is busy (`Regenerating…`) until the engine answers, which is
at once; by then the report is due, and the row reads `Report is being
generated.` until the outcome lands (convention §7.3.2). A refusal is a
notice in the error voice; so is a report that then fails, as on the
automatic path. A campaign run's own Report row has the same button once its
report has run, landed or failed — `report_rerunnable` on the campaign run —
and regenerates the campaign's report (convention §8.3).

**A campaign run's `Regenerate` is a split button**, since its report can be
regenerated at two depths. The face is `Regenerate` as above: the campaign's
own report, over the members' reports as they are, with nothing asked first.
A chevron joined to its right opens a menu naming both depths, each with a
line under it saying what it does:

```text
[↺ Regenerate|▾]
               ┌──────────────────────────────────────┐
               │ Campaign only                        │
               │   Re-run the campaign's report on    │
               │   the members' reports as they are   │
               │ Members, then campaign…              │
               │   Re-run all 24 member reports       │
               │   first, then the campaign's         │
               └──────────────────────────────────────┘
```

`Campaign only` is the face's own action. `Members, then campaign…`
re-runs every member's report and then the campaign's (convention §8.3); it
touches every run of the fan-out, so it asks first (§16.5). The split button
is there whenever either depth is on offer (`report_rerunnable`,
`members_rerunnable`): a campaign with no report of its own because a
member's report failed offers only the second, its face disabled with a
tooltip saying the members' reports come first. Each item that cannot be
taken is disabled, its second line giving the reason in place of what it
does: a locked member report names the member run, since the whole asking is
refused for it. The campaign's own lock disables the face and both items, as
for a job run. From the asking until the campaign's report lands, the row
reads `Regenerating member reports: N of M done.` while the members report,
then `Report is being generated.`, with no button. A refusal is a notice in
the error voice; a member's report that fails stops it there, with a notice
naming the member, and the campaign's report is left as it was.

Job runs and a campaign's calls keep the plain `Regenerate`: their reports
have no members.

A `Failed` run's report is shown exactly as a succeeded run's: the same
buttons, the same viewer. When its script failed, the row says
`Report script failed:` and the captured output, in the error colour, in
place of the state — or under the buttons, if the script wrote a file before
it failed. The status pill stays `Failed` throughout (§10.2).
