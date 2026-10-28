# 13. Job Overview Page

The Job overview is the default page after selecting a Job.

## 13.1 Header

Led by a 48px tile carrying the kind's sign on a wash of the kind's colour —
the Explorer row's sign (§11.4), large — then, top to bottom, what it is
called, what it is for, where it is:

- Job display name.
- The manifest's `description`, when it gives one.
- Folder path, after a folder sign.
- Manifest validity: when invalid, an amber callout under the head.

At the head's right, `Launch` — the play icon and the verb alone, no `Job` or
`Campaign` after it: the page's one primary, and the action it is opened for. It
leads to the Start page (§15). Disabled when the manifest is invalid, its tooltip
then carrying the reason. There is no `JOB` type label: the tile's sign says it —
a statement next to the name was one too many.

The description is held to three lines; a longer one scrolls inside itself. The
head must not push the history off the first screen — the history is what the
page is opened for, and a page that has to be scrolled before every glance is a
page that is scrolled all day.

`Remove` (§36) is at the **foot** of the page, under the history, after a rule
and a line saying what it does — `Take this job out of the Explorer. The folder,
its runs and its reports stay on disk.` Not beside Launch: a frequent button's
neighbour is the one clicked by mistake, and removal is the least frequent action
here. Red like every way of taking something away, a minus sign before the word,
tooltip `Remove from Explorer — the folder stays on disk` — the same removal the
Explorer's row menu offers, one modal behind both, and red in all three places:
the button, the menu item, the modal's confirm. Not an icon alone: a folder sign
by itself read as "open the folder". Not a bin: nothing on disk is deleted.
Remove stays available when the manifest is invalid.

Once the experiment has a history, a row of four small panels sums it up:
`Runs`, `Active` (blue), `Succeeded` (green), `Failed` (red, `Error`
included) — the numbers the page is opened for, before any row is read. A zero
is drawn muted, not in its colour.

Then, under a `Parameters` heading with its count, what it takes: a table with one row per
declared parameter, in declaration order, and three named columns — `Name`,
`Values`, `Description` (convention §2.2). The heading row is what says which
column is the description; without it the last column is just the longest
text. `Values` is phrased from the filling-in side, not the type system's: `a
string`, an enum's values with a slash between them (`ok / fail`) — and a
list wears brackets, `[strings]`, `[cuda, hip]`. The separator carries the
meaning: a slash to pick one of, commas inside brackets to take several of.
`No parameters.`
when it declares none. A parameter is read here before it is filled in on the
Start page, so this is where the description is shown in full, not on hover.
The table sits in a panel held to about five rows; a longer list scrolls inside
it, the heading row pinned — for the same reason the description stops at three
lines. The history follows, under `History` and its count, in a panel of its own
(§22).

Example:

```text
[⚗]  Solver GPU                                                  [▶ Launch]
     Mesh sweep across the GPU solver
     🗀 ~/Experiments/solver-gpu

[RUNS 12]  [ACTIVE 1]  [SUCCEEDED 9]  [FAILED 2]

Parameters 3
┌──────────────────────────────────────────────────────────────────┐
│ NAME      VALUES          DESCRIPTION                            │
│ mesh      a string        Mesh resolution, cells per side        │
│ gpu       0 / 1           Which GPU to pin to                    │
│ profile   true / false    Run under nsys                         │
└──────────────────────────────────────────────────────────────────┘

History 12
┌──────────────────────────────────────────────────────────────────┐
│ …                                                                │
└──────────────────────────────────────────────────────────────────┘
──────────────────────────────────────────────────────────────────────
Take this job out of the Explorer. The folder, its runs     [⊖ Remove]
and its reports stay on disk.
```

When the manifest is invalid:

- Show the validation message; the parameter list is not shown, since cocoa
  does not know them (convention §4).
- Disable Start.
- Explain why Start is disabled.

## 13.2 Active Runs Section

Place Active Runs above historical runs.

Heading:

```text
ACTIVE RUNS
```

If there are no active runs:

```text
No active runs.
```

Each active-run card shows:

- Status.
- Start time.
- Live duration.
- Parameters, truncated when necessary.
- Open action.
- Cancel action.

Example:

```text
Running

Started 10:24:31 · Duration 00:06:18
--mesh=256 --gpu=0

Open    Cancel
```

Runs are independent (§30). Any number of active-run cards may be displayed, and
Start is never disabled because a run is already active.

A card for a run dispatched by a Campaign must show its origin:

```text
Running                          from Nightly Benchmark · Run 10:24

Started 10:24:31 · Duration 00:06:18
--mesh=256 --gpu=0

Open    Cancel
```

## 13.3 All Runs Section

Heading:

```text
ALL RUNS
```

Controls:

- Status filter.
- Parameter search.
- Manual Refresh.
- Optional result count.

Default sorting:

```text
Newest first
```

Job columns:

```text
Started
Parameters
Source
Status
Duration
Report
```

`Source` shows where the run came from:

```text
—                     started directly by the user
Nightly Benchmark     dispatched by that Campaign
```

The Campaign name is a link to the owning Campaign run. Clicking it opens
`CampaignRunDetail`; clicking anywhere else in the row opens `JobRunDetail`.

Campaign-dispatched runs are ordinary history rows. Never hide them from the Job's
own history.

An origin filter (`All` / `Direct only` / `From a Campaign`) is P1.

The entire row is clickable and opens Job Run Detail.

The Report cell may contain an `Open` button. Clicking `Open` goes directly to the Report Viewer without also triggering the row navigation.

Parameters are truncated in the table but shown in full on hover and in the detail page.
