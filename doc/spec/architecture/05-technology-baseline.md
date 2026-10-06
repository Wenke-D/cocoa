# 5. Technology Baseline

The workbench is the classic Electron shape: the renderer is a web client, the
main process is the server, and the whole domain lives on the server side.

```jsonc
// cocoa-electron/package.json — the versions that matter
{
  "dependencies": {
    "express":   "^5.2.1",   // the agent socket's HTTP (§43) — wire code is never hand-rolled
    "nunjucks":  "^3.2.4",   // template rendering (§15.2)
    "smol-toml": "^1.8.0",   // cocoa.toml
    // The renderer's controls are shadcn-svelte components: source copied into
    // src/renderer/src/lib/components/ui/ and owned there, not a package. What
    // the copied sources import:
    "bits-ui":               "^2.16.3",  // the behaviour under Dialog, ContextMenu, Label
    "@internationalized/date": "^3.12.0", // bits-ui's peer; nothing of ours uses it
    "@lucide/svelte":        "^1.33.0",  // the icons (spinner, refresh, close)
    "tailwind-variants":     "^3.3.0",   // Button's variant table
    "clsx":                  "^2.1.1",   // `cn()` in /utils
    "tailwind-merge":        "^3.6.0",   // `cn()`: a later class overrides an earlier one
    "tw-animate-css":        "^1.4.0"    // the open/close animations the components carry
  },
  "devDependencies": {
    "electron":         "^43.4.1",
    "svelte":           "^5.56.9",   // runes; no store library
    "typescript":       "^6.0.3",
    "vite":             "^7.3.6",
    "electron-vite":    "^5.0.0",
    "vitest":           "^4.1.11",
    "electron-builder": "^26.15.3",
    "playwright-core":  "^1.62.1",   // drives the built app (§28)
    "tailwindcss":      "^4.3.3",    // the components' styling; app.css maps its names onto theme.css
    "@tailwindcss/vite": "^4.3.3"
  }
}
```

Commit `package-lock.json`.

**The renderer is a client, not the application.** It holds no domain logic. It
renders what the main process sends and asks for operations by name (§26). Node
integration stays off and context isolation stays on: the page's entire
vocabulary is what `src/preload/index.ts` puts on `window.cocoa` through
`contextBridge`: nine operations — `bootstrap`, `start_run`, `cancel`,
`delete_run`, `rerun_report`, `add_folder`, `remove_folder`, `report`,
`refresh_now` — and one event subscription, `on_events`. Nothing else
crosses.

**Templates are Jinja on both sides.** The engine renders an experiment's
templates with nunjucks; the egui implementation used minijinja. Both are
Jinja-family with the same delimiters and the same `{{ name }}` substitution, so
one experiment folder renders identically under either, which is what makes the
folders interchangeable. Template analysis is exact-match in both directions and
imports are rejected (§15.2).

**Names are `snake_case`, and the case tells you whose they are.** Everything
cocoa declares is `snake_case` — functions, methods, class fields, local
variables, parameters, the fields of `Route` and `UiState`, the preload
bridge's members, and the IPC channel names. What stays `camelCase` is what
belongs to somebody else: `fs.statSync`, `app.getPath`, Electron's
`webPreferences`, Playwright's `executablePath`, vitest's `testTimeout`. A
`camelCase` name in this codebase is a name from outside it.

The on-disk record format is not part of this rule, though it agrees with it.
`job_id`, `runs_by_job`, `last_successful_query` were `snake_case` before any
of it, because they are what serde writes and what `doc/spec/convention/`
specifies. They are fixed by the convention; the rest is fixed by this
paragraph, and the two must not be confused when one of them changes.

Component files stay `PascalCase.svelte` and `state.svelte.ts` keeps its
suffix: those are the frameworks' own conventions, and the rule above is about
names we choose.

**No async framework beyond what Node gives.** The engine's own operations are
synchronous and deterministic; the asynchrony in the application is the refresh
tick, the spawned scripts, and IPC.

Additional dependencies may be added only when clearly justified. Do not let
them float; do not upgrade without recording the reason.

**The renderer's controls are shadcn-svelte's.** Buttons, inputs, dialogs and
menus come from the shadcn-svelte registry, which copies source into
`src/renderer/src/lib/components/ui/` rather than installing a package: the
files are ours to read and edit, and each edited one says so at the top.
Tailwind is there because they are written in it; `app.css` tells Tailwind
that `bg-primary` is `--accent` and `bg-popover` is `--widget-bg`, so the one
palette in `theme.css` stays the one palette (ui-system.md). cocoa's own
screens keep scoped CSS on the tokens; utilities are for composing the
components and one-off placement beside them.

## 5.1 Why a Web View, Reversed

This section previously argued that Tauri, Electron, and an embedded WebView
were non-goals, and that the question had been *closed on measurement rather
than on preference*. The decision was reversed on 2026-08-20. Both records are
kept, because the reversal is only legible next to what it overturned.

**What the old argument said, and what became of each part.**

*Not for appearance.* Rendered side by side at 1280×820 on a 2× display — same
palette, same metrics, same Inter cuts — egui and a web view were
indistinguishable. This was measured and it still holds; nothing about it was
wrong. It was an argument that switching would buy no *fidelity*, and it did
not. What it did not measure is the cost of arriving at a given design, which is
where the difference turned out to be.

*Not for text handling.* Labels were already selectable and the report viewer
already searched, highlighted, and copied. Also still true, also not what
decided it.

*The engine would not move.* This was the load-bearing objection: behind a web
view the step that renders templates into an argv list and executes it has to be
reachable from page script, and the scope wide enough to allow that is the scope
that turns any injection into arbitrary command execution. **The classic
Electron split answers it.** The engine did not move into page script — it moved
into the main process, a Node process the page cannot call into except through
the ten declared members above. The property that actually mattered — that the
page's vocabulary is declared experiments and declared parameters, never a
command line — is preserved exactly, and by the same reasoning. The objection
was sound against an embedded WebView driving the engine. It was never an
argument against a main process holding it.

*What would re-open it.* The old record named the trigger: reports needing rich
rendering in-app, at which point the report viewer becomes a primary surface and
a web view is what renders one. That trigger fired — §20 now renders HTML
reports in a sandboxed frame instead of handing them to the system browser.

**What actually decided it.** Iteration speed and legibility of the programming
model, stated as preference and recorded as such rather than dressed up as a
measurement. A visual change is faster to make and to judge in CSS than in
immediate-mode layout code; the retained-mode, event-driven model is the one the
author reasons about most readily; and a workbench whose look is still being
worked out is worth more when its look is cheap to change. None of this
contradicts the measurements above — it is a different axis, and it is the axis
that mattered.

**What would re-open it again.** A hard startup-time or memory requirement that
Electron cannot meet; a target platform without a Chromium build; or a Linux-at-1×
comparison that finds the two renderers meaningfully different in the direction
the old record flagged as unmeasured. None of these is in play. The egui
implementation was kept beside this one until 2026-08-22 so the comparison
stayed possible; it is now in git history only (`coco-egui/`, before that date).

**What the reversal did not throw away.** The convention the folders follow, the
protocol §43 serves, and the questions the test suites ask were all worked out in
the egui implementation and all survived the move intact — which is the argument
for having written them down separately from the UI in the first place. The MCP
server survived as a *running artifact*: it was extracted to `cocoa-mcp/` and
drives the workbench without a line changed, because it only ever knew the
socket.
