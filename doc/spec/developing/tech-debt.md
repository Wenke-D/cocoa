# Tech debt / pinned versions

- `vite@^7` (electron-vite 5 rejects vite 8), `typescript@~6` (svelte-check
  rejects TS 7). Revisit when electron-vite/svelte-check catch up.
- `template.ts` reaches into `nunjucks/src/parser` and `nunjucks/src/nodes`
  (undocumented-but-stable internals, loaded via `createRequire`). A nunjucks
  major bump needs a look at the AST walker.
- `fs.watch` deliberately deferred: it would only cut manifest-edit latency
  below 3s. If added, watch-as-trigger only (debounce → run the existing
  reconcile); never interpret watcher events as truth; keep the 3s sweep.
- Engine timeouts are `DEFAULT_CONFIG` constants; no settings surface.
- `electron-builder` produces an **unsigned** app (`identity: null`): a
  signature needs a certificate this prototype has no business carrying, and a
  half-configured one fails the build rather than warning. macOS will ask
  before opening it. Only the mac targets have been built; linux/win are
  configured and untried.
- The agent socket serves whoever can open the file. That is the Unix-socket
  model and the same one the Rust cocoa has: file permissions are the access
  control, and every caller is already on this machine (§43).
- The dev CDP scripts once used for manual verification were lost with their
  session scratchpad. `scripts/drive.mjs` replaces them and lives in the repo
  this time. It is a verification tool, not a test suite: scenarios are
  written to be watched (and to leave screenshots), and they are not run by
  `npm test` — an Electron launch per scenario is too slow and too
  environment-dependent for that.
