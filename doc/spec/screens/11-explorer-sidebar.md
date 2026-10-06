# 11. Explorer Sidebar

## 11.1 Views

The sidebar hosts three views, selected from the activity bar (§8.2).

**Explorer.** The Benches and Jobs the user has added, grouped by kind (§11.2). This is the only persistent navigation surface. It carries no filter field: the Explorer is a short, fully visible list of folders the user added themselves. The run-history filters of §22.4 and the report search of §20.2 are unaffected.

**Active Runs.** Everything started and not yet finished. Top-level runs only: a Bench run appears once, never once per dispatched child, matching the count of §21. The members a Bench run still has running are listed beneath it, indented, as what it is made of — not counted, and leading to the child seen through its bench (§19). Rows show the entity name and the run's status badge, and navigate to that run's detail page, where Cancel lives. When nothing is running, show a subtle `Nothing is running.` note rather than an error.

**Events.** What happened, newest first: a run that started and by whom, a status that moved, a report that landed, a run cocoa lost sight of or found again, a folder that was added or removed, a manifest that broke or healed, and any failure the status bar reported. Each entry is the moment, the experiment, the run, and what happened — the last coloured by what it means: green for a report landing, a success or a run found again; red for a failure; amber for a run cocoa cannot see; blue for news; grey for the rest. Entries are kept apart by a rule. The backend only says what changed, as it always has (§26.3); the renderer, which holds the entry as it was, says what moved — the backend knows nothing of this view. The last hundred are kept, in the page's memory only: a reload or a relaunch starts empty. An entry about something still listed navigates to it. When nothing has happened, show a subtle `Nothing has happened yet.` note.

## 11.2 Grouping

Display separate groups:

```text
BENCHES
JOBS
```

Empty groups may be hidden or show a subtle empty label.

## 11.3 Entity Row

Each entity row shows:

- Type indicator.
- Display name.
- Active-run count when greater than zero.
- Last-run status when there is no active run.
- Invalid-manifest warning when applicable.

Priority:

1. Active-run count.
2. Invalid-manifest warning.
3. Most recent completed status.
4. No status indicator for never-run entities.

Example:

```text
Nightly Benchmark       1
Solver GPU              Failed
Post Process
Invalid Experiment      Invalid
```

Do not rely on color alone.

Use an icon or text together with semantic color.

## 11.4 Selected Row

The selected row must have a clear background highlight: a light wash of the
theme's accent blue, not a grey — grey is the hover's colour, and a selection
that is the hover with a little more weight is not clear.

It must remain selected when viewing:

- A run.
- A run dispatched by that Bench.
- A report.

## 11.5 Add Folder

`Add Folder` is a secondary action. It is reached from the `+` icon button in the Explorer view's title row (§8.3), and from the empty page's button (§12).

Clicking it opens the operating system's own folder picker. Nothing stands between the click and the picker, and a path is never typed by hand. Cancelling the picker does nothing at all.

**One pick is one folder.** The chosen directory registers if it carries a `cocoa.toml` of its own, and is refused if it does not. cocoa does not search inside it for experiments.

This is a decision, not a shortfall. A scan has to guess how deep to look and what to skip, and it answers a pick with a list the user did not choose — several folders registered at once, some refused, each for its own reason, none of it visible until afterwards. Picking the folder you mean is one more click and no guessing. `coco-egui/` searched three levels down and needed a modal to report what it had done; that modal is what the rule below replaces.

A folder registers only if its manifest is usable at the moment it is picked. An unusable one is refused with the reason — a missing table, a name already taken, a folder that cannot be read.

A manifest that breaks *afterwards* is the opposite case: the entity stays in the Explorer, and its page shows the validation message with Start disabled (§13.1). It is an entity the user knows and has run, and dropping it out of the list would hide both the entity and the mistake. The rule is that the Explorer never gains a row that has never worked, and never loses one that used to.

A folder already in the Explorer is a no-op, never a duplicate.

Registering must immediately update the Explorer and select the folder that was added, so the user lands on the result of their action rather than wherever they were.

One pick has one outcome, so it needs one sentence, not a modal:

```text
Folder added.                                 registered
That folder is already in the Explorer.       a no-op, and says so
cocoa.toml: missing required table `[launch]`  refused, with the reason
```

A refusal is an error notice and stays until dismissed (§8.5); the other two fade. The reason is the engine's own sentence, unchanged — the user picked this folder, so the answer is about this folder.
