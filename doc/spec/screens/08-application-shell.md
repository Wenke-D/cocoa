# 8. Application Shell

The persistent application shell is:

It is laid out as a workbench, in the order the panels claim space: activity bar, sidebar, main content, status bar.

```text
┌────┬───────────────────┬────────────────────────────────────────────────┐
│    │ EXPLORER         + │                                                │
│ Li │                   │                                                │
│ Ru²│ v BENCHES         │                 Main Content                   │
│ Ev │   Nightly Bench 1 │                                                │
│    │ v JOBS            │  Entity overview, run detail, dispatch, or     │
│    │   Solver GPU      │  report                                        │
│    │   Post Process    │                                                │
│ Mg │                   │                                                │
├────┴───────────────────┴────────────────────────────────────────────────┤
│ 2 active runs   last change 22:35:13   (refresh)                        │
└─────────────────────────────────────────────────────────────────────────┘
```

There is no in-window top bar. The platform window title bar carries the application name.

## 8.1 Default Window

Use approximately:

```text
Default size: 1280 × 820 logical points
Minimum size: 900 × 600 logical points
```

The app must remain functional at the minimum size.

## 8.2 Activity Bar

A fixed-width icon strip on the far left, spanning the full height above the status bar.

It contains, top to bottom:

1. `Explorer` view icon.
2. `Active Runs` view icon, carrying the active-run count as a badge.
3. `Events` view icon.
4. `Manage` gear, pinned to the foot of the strip.

Behavior:

- Clicking an item that is not currently open selects that sidebar view and opens the sidebar.
- Clicking the item that is already open collapses the sidebar.
- The open item sits on the same accent wash as the Explorer's selected row, and hover is the rows' hover wash (§11.4): one way of saying "the one that is open", whether it is a view or a folder. Not VS Code's edge rule — that would be a second idiom for the same thing.
- Every item has a tooltip.

The badge:

- Is hidden when the count is zero.
- Reads `99+` above ninety-nine.
- Counts a Bench run once, not once per dispatched child (§21).

The gear opens a menu carrying the `Color Theme` choice (§24.3). It carries nothing else; every other global action has a home elsewhere in the workbench.

The title of the currently selected entity belongs in the main content, never in global chrome.

## 8.3 Sidebar

Recommended dimensions:

```text
Default width: 220
Minimum width: 180
Maximum width: 300
```

The sidebar is resizable within these limits, and the width the user drags to persists.

The sidebar hosts exactly one view at a time, chosen by the activity bar (§8.2). Each view opens with a title row carrying the view name in small uppercase text, followed by that view's actions.

The `Explorer` view contains:

1. Title row, whose one action is a `+` icon button opening `Add Folder` (§11.5).
2. `BENCHES` section.
3. `JOBS` section.

Both sections are collapsible, and their collapsed state persists.

A section heading is bold, uppercase and flush left, on the same left edge as the view's title row above it, with its rows indented under it — and that is all that marks it — no ground of its own, as VS Code draws them. The only row in the Explorer with a ground is the selected one (§11.4); a heading on a grey band beside a selection on a grey wash said the same thing twice, and the reader had to work out which was which.

The two sections are panes, `BENCHES` above `JOBS`, each scrolling on its own, with a horizontal divider between them that drags; where it sits persists with the sidebar's width. The divider is a visible line — the lower pane's top edge — so a reader knows there is one, and it takes the accent colour under the pointer, which is how it says it drags.

The `Active Runs` view contains a title row with no actions, followed by its rows (§11.1).

The `Events` view contains a title row with no actions, followed by the last hundred things that happened, newest first (§11.1).

Which view is open, and whether the sidebar is, persist with its width.

The sidebar remains visible on all normal pages unless the user collapses it from the activity bar.

## 8.4 Main Content

The main content changes according to the current route.

It must support:

- Vertical scrolling.
- Wide tables.
- Breadcrumbs.
- Full-width run details.
- Full-width Bench dispatch table.
- Full-width report viewer.

## 8.5 Bottom Status Bar

Three standing items:

- Number of active runs.
- The time of the last change: the moment of the newest Events entry, as a clock time — `last change 22:35:13` — never a count that ticks, and never the refresh tick, which says nothing at three seconds. It opens the Events view.
- Refresh action, as an icon.

Two conditional items, shown only when they apply:

- Query interruption warning.
- Temporary success or error message, right-aligned, with a `Dismiss` action.

The transient message is the only place a failed Refresh or Cancel reports itself.

Do not display verbose logs here.
