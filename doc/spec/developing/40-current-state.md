# 40. Current State and Outstanding Work

The workbench is built. What follows is the standing list, not a build order.

**Working:** the engine port in full — manifests, templates, the job lifecycle,
the poll protocol, auto and manual reports with ERROR healing — the manual
re-run reachable from the run page and the agent socket — reports for failed
runs beside their status, cancel, bench
plan and fan-out, derived bench status, orphan detection, abandonment at close.
Memory as the truth with write-through; records read once, manifests re-read
each tick (§26.1); guarded writes, no queue (§26.2). Event-driven
sync (§26.3). Notices (§26.4). The journal and the Events view, the
activity bar with Explorer and Active Runs (§8, §11.1). The agent socket and the MCP binary (§43). The
persisted arrangement (§32). Explorer, overview, start, run detail, bench run
detail, bench child detail, report viewer for both formats, add and remove
folder, cancel with confirmation. An electron-builder package.

**Outstanding**, roughly by what each one costs:

- **Renderer component tests.** The biggest hole: the Svelte components and
  the IPC handlers in `index.ts` are covered only by the drive scenarios.
  Needs a component runner and an `index.ts` that lets a handler be called
  without `app.whenReady()`.
- The agent interface has no cancel, no registration, and no event stream
  (§43.6).
- The query-interruption banner and a per-run retry.
- Explorer and run filtering, search, the in-app theme toggle, Settings.
- Open a report externally; report-viewer virtualisation.
- `--dump-state`.
- Linux has not been exercised: neither the build nor the rendering comparison
  §5.1 flags as the one measurement that could revise its own record.
- Packaging is unsigned; no notarization, no auto-update (§4.2).

The gap tables below say what each of these looked like in the egui
implementation, where most of them existed.
