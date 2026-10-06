# Driving the built app

`npm run drive` launches the **built** app under Playwright, against a scratch
copy of `examples/` in `.drive/` with a store of its own — never the real store, so
it cannot disturb the real Explorer. Screenshots land in
`.drive/shots/`; renderer console errors are reported at the end, including
when the scenario fails. Scenarios live in `scripts/scenarios/` and are plain
modules exporting `run({ page, app, shot, log, waitText })`. Rebuild before
driving — it runs `out/`, not the dev server.

Scenarios that exist today: `cancel.mjs`, `cancel-campaign.mjs`, `report.mjs`,
`add-folder.mjs`, `remove-folder.mjs`, `notice.mjs`, `persistence.mjs`,
`campaign-child.mjs`, `agent.mjs`, `events.mjs`, `history.mjs`. A scenario may
also call `relaunch()` — quit and start again against the same store and
ui-state file, the only way to drive what is supposed to survive a launch —
and `DRIVE_PACKAGED=1` runs any of them against the packaged `.app` instead of
the dev binary. A scenario may `export const seed = 'library-only'` to launch
against a store with nothing registered — the engine reads `store.json` exactly
once, at construction, so an empty store is a launch-time decision, not
something a scenario can arrange afterwards.

`COCOA_BOOTSTRAP_DELAY_MS=<n>` holds the bootstrap answer for n ms — the only
way the renderer's sub-second Starting state (§12) can be seen or driven.

`DRIVE_HEADLESS=1` opens the window without showing it (`COCOA_HIDE_WINDOW` on
the app side). Playwright drives the page over CDP and screenshots it the same
way, so nothing is lost but the view — and sweeping every scenario stops taking
the focus eleven times in a row, which made the machine unusable while it ran.
Off by default, because watching it is the point.

This is a verification tool, not a test suite. Scenarios are written to be
watched and to leave screenshots, and they are not run by `npm test` — an
Electron launch per scenario is too slow and too environment-dependent.
