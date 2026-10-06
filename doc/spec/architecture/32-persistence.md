# 32. Persistence

The arrangement lives in two places, and the two never meet in one object:
the renderer keeps its layout in its own localStorage (`ui_state.ts`,
written once as the page unloads), and the main process keeps the window's
geometry in `window-state.json` in Electron's `userData` directory
(`src/main/shell/window_state_file.ts`). Neither is the engine's `store.json`: the
store is the *experiments'* memory (convention §5) and has no business
holding how a window was arranged.

Persist:

- Sidebar width, and the Explorer's divider.
- Report wrap setting.
- Window geometry.

Geometry is recorded at the endings: once the window opens (what it actually
got) and at its close. A quit closes the window first, so the close's write is
the last word — nothing tracks resizes as they happen.

Do not persist:

- **Where the user was.** Every launch opens on the Explorer with nothing
  selected — the empty page. A day later nobody remembers where they were,
  and the page that helps is the list of experiments, not yesterday's run;
  so the route, the sidebar's view and whether it was open are session
  state, gone at quit. (Routes used to be restored, with rules for the ones
  that could not be — a report, a Start draft; dropping restoration retired
  those rules whole, 2026-08-23.)
- Anything about runs. The experiment folders hold their own records — the
  UI keeps no copy.
- Overlays. A modal is an action, not a place (§9).
- Transient notices.
- Parameter drafts. A draft survives a failed submission (§31) and nothing
  longer.

**What comes back is untrusted.** The file may be older or newer than this
build, or edited by hand. Everything loaded goes through `sanitize()`, which
clamps what it keeps and does not read what this build no longer stores. A
file that fails to parse is not an error worth stopping for: the worst case
is a window that opens the way it always opens.
