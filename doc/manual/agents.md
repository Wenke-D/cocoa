# Working with an agent

An AI agent can drive cocoa as you do: register an experiment, start runs,
follow them, re-run a report. It reaches the same engine your window drives,
and everything it does lands on your screen, stamped `agent`. This page is how
to connect one, and the rules it should work by. The routes and their exact
answers are the [agent interface](../spec/agent/43-agent-interface.md).

## Connecting

cocoa answers on a Unix socket, `~/.local/share/cocoa/cocoa.sock`, **only
while its window is open**. An agent reaches it one of two ways:

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
  `cocoa_job`, `cocoa_campaign`, `cocoa_start` and `cocoa_register`.
  `cocoa-mcp-server --help-ai` prints where this guidance lives.

- **Over HTTP on the socket**, for a script or a quick look:

  ```bash
  curl --unix-socket ~/.local/share/cocoa/cocoa.sock http://localhost/help
  ```

`GET /help` (the `cocoa_help` tool) describes every route from the running
cocoa itself. Answers carry file locations rather than contents: the agent
reads a run's record and report straight from disk.

## The rules

1. **Everything goes through cocoa.** Start runs with `cocoa_start`, follow
   them with `cocoa_job`, re-run a report through the socket. Never submit
   work by hand — no `sbatch`, no `ssh` to launch — so that you and the agent
   look at the same runs. A quick test is still a cocoa experiment: make a
   small smoke job for it and register it with `cocoa_register`.
2. **If cocoa is not answering, ask.** The socket exists only while the window
   is open. When a tool says cocoa is not answering, ask the user to open it;
   do not work around it.
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
6. **What the socket cannot do yet, ask the user to do in the window.** There
   is no cancel route, and no way to take an experiment out of the Explorer:
   ask, naming the run or the folder.

How to write the scripts themselves — and what a report should say — is
[authoring.md](authoring.md).
