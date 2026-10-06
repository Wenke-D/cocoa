# 28. Development Controls

There are no mock controls, because there is no mock: state advances because a
real script said so. What replaces them is a way to drive the real application.

`npm run drive scripts/scenarios/<name>.mjs` launches the **built** app under
Playwright over Electron's own binary and runs a scenario against it — the
"click it and look" path, not headless CI. A scenario is a module exporting
`run({ page, app, shot, log, waitText })`.

A drive run is fully isolated from the real one, and must stay that way:

```text
COCOA_STORE_PATH      a scratch store    — a drive run registers folders; not in the real one
COCOA_UI_STATE_PATH   a scratch layout   — a drive run must not move the user's window
COCOA_SOCKET_PATH     a scratch socket   — must not take the socket a real cocoa answers on
```

The library is seeded as a private copy of `examples/`, never the user's own.

Scenarios cover: add-folder, remove-folder, cancel, cancel-bench, bench-child,
report, notice, persistence, agent.

Everything else is a test (§37). Do not add developer affordances to the
production UI, and do not put them inside run-history rows.
