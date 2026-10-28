# Working with an agent

An AI agent can drive cocoa as you do: register an experiment, start runs,
follow them, cancel them, re-run a report. It reaches the same engine your window drives,
and everything it does lands on your screen, stamped `agent`. This page is how
to connect one, and the rules it should work by. The routes and their exact
answers are the [agent interface](../spec/agent/43-agent-interface.md).

## Connecting

cocoa answers on a Unix socket, `~/.local/share/cocoa/cocoa.sock`, **only
while its window is open** — though an agent may open it (rule 2). A cocoa started with `--profile <name>` answers on
`cocoa-<name>.sock` beside it instead; point an agent there with
`COCOA_SOCKET_PATH`. An agent reaches it one of two ways:

- **Through MCP**, the usual way. Build the bundled server (`alors mcp::build`,
  or `cargo build` in `cocoa-mcp/`) and register the binary with your agent's
  MCP client — for Claude Code:

  ```bash
  claude mcp add cocoa -- /path/to/cocoa/cocoa-mcp/target/debug/cocoa-mcp-server
  ```

  or, in a client configured by JSON:

  ```json
  { "mcpServers": { "cocoa": { "command": "/path/to/cocoa-mcp-server" } } }
  ```

  Its tools are `cocoa_help`, `cocoa_list_jobs`, `cocoa_list_campaigns`,
  `cocoa_job`, `cocoa_campaign`, `cocoa_start`, `cocoa_register`,
  `cocoa_cancel` and `cocoa_lock_report` — and `cocoa_launch`, which opens
  cocoa when it is not running (rule 2). It starts `cocoa` from the `PATH`
  (the app bundle on macOS); set `COCOA_APP` in the server's environment to
  the cocoa executable when it lives elsewhere.
  `cocoa-mcp-server --help-ai` prints where this guidance lives.

- **Over HTTP on the socket**, for a script or a quick look:

  ```bash
  curl --unix-socket ~/.local/share/cocoa/cocoa.sock http://localhost/help
  ```

`GET /help` (the `cocoa_help` tool) describes every route from the running
cocoa itself. Answers carry file locations rather than contents: the agent
reads a run's record and report straight from disk. A report's location is its
`.txt` — the short answer — or its `.html` when that is all it wrote; when both
exist, the HTML, the long analysis, sits beside the text with the other
extension.

## The rules

1. **Everything goes through cocoa.** Start runs with `cocoa_start`, follow
   them with `cocoa_job`, stop them with `cocoa_cancel`, re-run a report
   through the socket. Never submit or stop work by hand — no `sbatch`, no
   `scancel`, no `ssh` to launch — so that you and the agent look at the same
   runs. A quick test is still a cocoa experiment: make a
   small smoke job for it and register it with `cocoa_register`.
2. **If cocoa is not answering, open it, and say so.** The socket exists only
   while the window is open. When a tool says cocoa is not answering, call
   `cocoa_launch`: it opens the user's own cocoa window, on their screen, and
   returns once cocoa answers. Over raw HTTP, start the app the same way,
   detached — `setsid cocoa >/dev/null 2>&1 &` (`open -a cocoa` on macOS),
   with `--profile <name>` for a named profile's socket — then wait for the
   socket. Tell the user you opened it, and leave it open. Never use it to
   restart or replace a cocoa that is running, and never run cocoa hidden or
   headless to get around the window.
3. **Change an experiment in its folder, deliberately.** The folder is the
   experiment: edit its manifest and scripts there, keep its `description` and
   its report in step with its purpose, and say what changed. Never patch
   what a run uses somewhere else — on the cluster, in a copied script —
   where the user cannot see it.
4. **Make it ready through `check` and `deploy`.** Putting the executable,
   its configuration and its auxiliary material in place is those scripts'
   job, run by cocoa before every start — never a step done by hand before
   one. See [authoring §5](authoring.md#5-the-job-scripts).
5. **Leave `runs/` and `report/` alone.** They are cocoa's. Read them; never
   edit them.
6. **Cancel only what you were asked to stop, or started yourself.** The
   window asks a person to confirm a cancel; `cocoa_cancel` does not. Cancel a
   run the user named, or one of your own that has gone wrong, and say which
   run you cancelled and why. Cancelling a campaign run stops every member
   still running; to stop just one, cancel it under its own job.
7. **A locked report is the user's.** A run's report can be locked, in the
   window or with `cocoa_lock_report`; while it is, it is not regenerated and
   its run is not deleted (`report_locked` on the run says so). Lock or unlock
   one only when the user asks. When something you were asked to do is
   refused because a report is locked, say so and leave the lock alone.
8. **What the socket cannot do yet, ask the user to do in the window.** There
   is no way to take an experiment out of the Explorer: ask, naming the
   folder.

How to write the scripts themselves — and what a report should say — is
[authoring.md](authoring.md).
