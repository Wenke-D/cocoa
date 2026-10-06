# 44. Definition of Done

A change is done when all of the following hold.

**Product**

- It launches as a macOS desktop application.
- It builds as a Linux desktop application.
- The Explorer registers the demonstration library in `examples/` and runs it.
- Selecting an entity shows its status and history.
- Start is a page under the experiment, not a modal over it (§15).
- Starting spawns the real launch script and the run is visible immediately (§3).
- A new run opens in full-page detail.
- Active status updates are visible without a manual action.
- Cancel uses a confirmation modal.
- Query failure is visually distinct from execution failure, and cocoa's `Error`
  from the experiment's `Failed` (§10.2).
- Clicking any history row opens a full run-detail page.
- Bench runs display a full-width dispatch table of every run they started.
- A Bench dispatches all of its calls at once, with no ordering or dependency.
- A run dispatched by a Bench appears in the referenced Job's own history, stored
  once and reachable from both contexts, showing the same facts either way (§19).
- Reports open in the full main-content area, plain text and HTML alike (§20).
- Reports can be searched, wrapped, selected, and copied.
- The sidebar remains the only persistent navigation panel.
- The arrangement survives a relaunch, sanitized (§32).
- The application remains usable at 900 × 600.
- The application remains responsive with 500 run-history rows.

**Architecture**

- `src/main/engine/` imports nothing from Electron.
- `src/renderer/` imports nothing from `src/main/`.
- The preload bridge gained no general-purpose channel.
- The renderer judged no change and mutated no world entry.
- Records stay readable across versions: a folder an earlier cocoa wrote still
  loads (`convention.md`).

**Checks**

- `npm run gate` succeeds — format, lint, types, tests.
- `npm run build` succeeds.
- README instructions reproduce the build on macOS.
