# Running it

```bash
cd cocoa-electron
env -u ELECTRON_RUN_AS_NODE npm run dev     # VSCode terminals leak ELECTRON_RUN_AS_NODE; it breaks Electron

npm run gate                                # format:check → lint → check → test
npm run format                              # prettier --write .
npm run lint                                # eslint, type-aware
npm run check                               # svelte-check + tsc (includes tests/)
npm test                                    # vitest, ~10 s
npm run test:watch                          # vitest in watch mode

npm run build && npm run drive scripts/scenarios/cancel.mjs   # drive the real app
DRIVE_HEADLESS=1 npm run drive scripts/scenarios/cancel.mjs   # ... without a window on screen
npm run package                             # electron-builder → release/ (unsigned)
npm run package:dir                         # unpacked .app only, for driving
DRIVE_PACKAGED=1 npm run drive scripts/scenarios/agent.mjs    # drive the packaged app
```

From the repository root, `alors install` packages and then puts the build
where the desktop can find it, for this user and without root: the AppImage as
`~/.local/bin/cocoa`, every icon size into `~/.local/share/icons/hicolor/`, and
a `.desktop` whose `StartupWMClass` matches what the window reports. That match
is what lets a desktop environment resolve the icon through the theme and draw
it at the size it wants; without it the fallback is `_NET_WM_ICON`, which
carries one size and is scaled by whatever is drawing it. The task's comment
says how to undo it.

`npm run gate` is the one command that has to pass. It runs cheapest-failure
first.

The other tree:

```bash
cd cocoa-mcp  && cargo build && cargo test   # the MCP server; serde_json only
```

## Or through alors

`tasks.alors` in the repository root wraps all of the above, so two trees with
two build systems answer to one verb. It reads only the current directory's task
file, so run it **from the root**:

```bash
alors                       # list the tasks
alors dev                   # the workbench, with ELECTRON_RUN_AS_NODE unset for you
alors gate                  # the workbench's gate
alors gate all              # both trees
alors drive cancel          # build, then drive a scenario
alors mcp                   # build, lint and test the MCP server
```

One task per invocation; tokens after it are arguments or a subcommand. It is a
convenience over the commands above, never a second definition of them — the
`gate` task shells out to `npm run gate` rather than restating its sequence.
