# 22. Run-History Table Behavior

Job history, Bench history, and Bench dispatch tables share one table
treatment, defined once (`table.runs` in `theme.css`) rather than per page.

**Widths are declared, never measured.** The layout is fixed, and each column's
width is set by a `<col>`. Under automatic layout a column is sized from its
content, so a status going from `RUNNING` to `CANCELLING` widens its own cell
and shoves its neighbours sideways — on a three-second tick, in a table
somebody is reading. Declared widths mean the only thing that changes is the
text inside a cell.

**Slack goes to the last column.** A window is usually wider than the table
needs. Whichever column is left without a width absorbs the difference, so it
must be the rightmost one: give it to a column in the middle and every row
opens a gap through it. The empty space belongs at the table's edge.

**Anything can overflow, so everything truncates.** A fixed column cannot grow.
Content longer than its width ends in an ellipsis and carries the full value as
hover text (§22.3, §36).

## 22.1 General Rules

- Fixed header.
- Vertically scrolling body.
- Newest runs first.
- Consistent row height.
- Entire row is clickable.
- Hover state.
- Selected or focused state where applicable.
- No horizontal layout jitter when durations or relative times update.
- Stable status-dot and Run column widths.
- Stable Report-column width.

## 22.2 Suggested Column Behavior

Each column is sized for the widest value it can actually hold — a dot, a
run id, a duration, `59 minutes ago`, `CANCELLING` with its dot — except one,
which is left unsized and takes what is left. Arguments is the one column
whose content has no bound — a sweep is what varies them — so in every table
it is the one worth the leftover width.

Job history:

```text
            22    the status dot (§23), under no heading
Run         54    a run id, flush right, so the digits line up, with room after it
Arguments    —    remainder; the run's arguments, as given, on code's ground
Duration   100    `HH:MM:SS` while it runs, `1h 12m 33s` once it ended
Started    116    `2 days ago`; the locale date and time on hover
By          80    `you`, `agent`, or a bench name and call number, truncated
```

Bench history:

```text
            22
Run         54
Arguments    —    remainder
Duration   100
Started    116
By          80
```

A bench history has no Calls column: how many members a run dispatched is
the plan's business, on the run's own page (§18), and it was the one count
in a row of facts.

Bench dispatch:

```text
#          54    the call index, flush right, with room after it
Job       180    an experiment name
Status    116
Arguments   —    remainder
```

In a history the arguments come second, right after the id: they are what
tells one run of an experiment from the next, and the history is read to
find a run. The dispatch table keeps them last — its rows are told apart by
the call index and the job, and the arguments are what a sweep varied.

A duration is a clock while the run is live — `HH:MM:SS`, ticking — and a
length once it has ended: `1h 12m 33s`, `2m 0s`, `5s`, the empty leading
units dropped. A finished run's duration is a fact, and `00:00:00` reads as
a clock still to start. The same helper serves the detail pages, so they
agree with the table.

A start is said relative to now — `just now`, `38 seconds ago`, `2 days
ago`, `3 months ago` — in the largest unit that fits, whole; the locale date
and time is the cell's hover text, and the run's page prints it. A history is
read for how long ago, and a timestamp makes the reader subtract.

Arguments are the string as given — `--gpu 0 --mesh 1024` (§17.3) — on
inline code's ground, as the run's page shows them: a chip that ends where
the text does, and truncates inside itself. The heading over it is set in
by the chip's padding, so it sits over the text rather than the ground.

## 22.3 Long Arguments

In tables:

- Truncate with ellipsis.
- Show full text on hover.
- Show complete text in details.

## 22.4 Filtering

Job and Bench overview pages support:

- Status filter.
- Parameter text search.

Filters affect All Runs only, not Active Runs.

## 22.5 Dataset Size

The demonstration library must support at least 500 history rows without making
the UI unusable.

A Bench plan must support at least 50 dispatched runs, since a parameter sweep is
the primary use case. The dispatch table must stay usable at that size.

A drive scenario (§28) may start a larger dataset to check this.

---

## 22.6 Row Menu

Every row of a job or bench history has a context menu with two actions, both
about that run's parameters:

- **Start over** starts a new run at once, with exactly the values this run
  had. The backend validates them against the manifest as it is now; if they
  no longer match — a parameter added, removed or renamed — nothing starts,
  and the refusal is shown in a modal with one `OK`, because it has to be
  read. On success the new run appears in the table and the transient message
  names it; the page does not move.
- **Refill…** opens the Start page (§15) with this run's values filled in, as
  far as the manifest now allows: a parameter it no longer declares is
  dropped, one it newly declares is left empty, one whose value no longer
  fits its shape — an enum value since removed, one string where a list now
  is — is left empty too, and the message says which. The user still presses
  Start — which is what the ellipsis says: this one opens something, the
  other acts.
