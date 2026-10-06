# 4. Scope

## 4.1 P0 Requirements

The workbench must include:

- A macOS desktop application.
- A Linux desktop application.
- Activity bar selecting the sidebar's view.
- Narrow persistent left sidebar.
- Large unified main-content region.
- No permanent right-side inspector.
- Job overview.
- Campaign overview.
- Start page.
- Cancel confirmation modal.
- Job run-detail page.
- Campaign run-detail page.
- Campaign child-run detail page.
- Report viewer, plain text and HTML (§20).
- Active Runs section.
- All Runs table.
- Campaign dispatch table.
- Breadcrumb navigation.
- Real manifests, templates, and process execution ([convention](../convention/README.md)).
- The demonstration library in `examples/` registering and running unchanged.
- Query failure shown without overwriting the last known status.
- Automatic and manual report retrieval.
- Active Runs sidebar view.
- Status filtering in run history.
- Window resizing.
- Keyboard interaction.
- Light and dark theme compatibility.
- Basic persistence of UI preferences.
- Unit tests for engine state transitions.
- README with macOS and Linux run instructions.

## 4.2 Optional P1 Features

The following may be added after all P0 requirements work:

- Sortable table headers.
- Column-width persistence.
- Keyboard selection inside tables.
- Visual snapshot tests.
- Code signing and notarization.
- Auto-update.

## 4.3 Explicit Non-Goals

Do not implement any of the following:

- Filesystem watchers. The refresh tick is the only clock (§7.5).
- Remote execution arranged by cocoa itself. A manifest's own scripts may reach
  a cluster over SSH or Slurm; cocoa runs the script and knows nothing of what it
  reaches.
- Authentication.
- User accounts.
- A network server. The agent interface is a unix socket (§43.2).
- A database. The experiment folders are the record.
- DAG editing.
- Pipeline editing.
- Drag-and-drop pipeline construction.
- System tray integration.
- Notification-center integration.
- Plugin architecture.
- Full localization.

Do not allow these non-goals to delay the workbench.

Removed from this list, and no longer non-goals: real manifest parsing, folder
scanning, the OS folder picker, process execution, polling, cancellation
signals, and stdout capture were the mock-phase exclusions, and are all
implemented. Electron was a non-goal until the decision recorded in §5.1 was
reversed; React, Flutter, and Qt were listed beside it and are simply not the
stack — see §5.
