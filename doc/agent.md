# The agent interface

cocoa can be driven by an agent as well as by a person: the same operations,
the same guarded engine, the same screen, with one word on the record saying
who asked.

Covered here: §43.

---

## 43. Agent Interface

An agent asks cocoa to do things. It never runs an experiment's scripts itself,
and it never touches the store: cocoa is the one owner, and the owner is the
window (§9).

### 43.1 Availability

The interface exists only while cocoa is running. That is a decision, not a
limitation to be worked around. A run started through it belongs to the store
the user is looking at, and appears there exactly as a click's run does.

An agent therefore cannot act while cocoa is closed. What cocoa must do instead is
catch up on the way back up: a run in flight when the window closed is polled on
the first refresh, and if the cluster finished it, the stage that follows runs
(§10).

### 43.2 Transport

A Unix domain socket at a fixed path per build —
`$HOME/.local/share/cocoa/cocoa.sock`, with `cocoa-dev.sock` beside it for the
dev build, overridable with `COCOA_SOCKET_PATH`. The dev build's own file keeps
hacking on cocoa from stealing the packaged cocoa's socket; the single-instance
lock cannot referee across builds.

A socket rather than a TCP port: there is no port to discover, publish, or
collide over, nothing else on the machine reaches it by accident, and the
filesystem's own permissions decide who may. Socket paths are bounded well below
a filesystem's path limit, so a failure to bind is reported with the path in it.

The wire format is HTTP/1.1, so `curl --unix-socket` is the whole client
library. Both ends speak it through libraries a reviewer never has to audit:
the workbench serves through Express on Node's `http` server, and the bundled
`cocoa-mcp-server` asks through libcurl — routing, decoding, framing, and the
body cap are theirs. What stays cocoa's is what no library decides — who may
bind the socket, when the file goes away, and where a request's answer comes
from. Request bodies are capped at 64 KiB; a larger declared length is
answered `413` before a byte of it is read.

Failing to bind is fatal: no agent interface, no cocoa. A socket file already
at the path is deleted outright, not probed: a Unix socket cannot listen where
a file sits, dead or not, and nothing alive can own it — the single-instance
lock keeps each build to one cocoa, and each build listens on its own path.

### 43.3 Path through the application

Every request lands on the same engine the screen drives, on the same event
loop. An agent's start takes the same call a click takes — the same
validation, the same origin stamping (§10.6), the same write guards (§26.2),
the same screen update. There is no second way into the engine to keep in
step with the first.

Reads are answered from the snapshot the worker publishes after each pass, so
they never wait on one. Writes wait, because the engine has one owner and the
socket thread is not it. A wait that outlives its welcome is answered `503`
rather than left hanging.

### 43.4 Surface

```text
GET  /help                         what this is, and every route, from the tool itself
GET  /jobs                         every Job: name, folder, parameters, run tallies
GET  /benches                      every Bench, same shape
GET  /jobs/{name}                  one Job and its runs, with file locations
GET  /benches/{name}               one Bench, its runs, their calls and locations
POST /experiments                  {"path": "/abs/folder"} → 201 {"name", "kind", …}
POST /experiments/{name}/runs      {"parameters": {…}} → 201 {"run_id": "…"}
POST /experiments/{name}/runs/{run_id}/report
                                   re-run a job run's report → 202, once it is due
```

Experiments are addressed by name, which is unique across the Explorer
(convention §5): an agent should not have to know folder paths — except the
once, to register one.

**Registering a folder** takes the Explorer's `+` path: the same
`add_folder` the picker's answer goes through, the same refusals. The body
names the folder by **absolute** path — the agent's working directory is not
cocoa's, and a relative path would quietly resolve against the wrong one — and
its `cocoa.toml` decides whether it is a Job or a Bench:

```json
{ "name": "solver-gpu", "kind": "job", "folder": "/abs/solver-gpu",
  "already": false, "follow": "/jobs/solver-gpu" }
```

`201` for a folder newly registered; `200` with `already: true` for one that
was registered already — a no-op, never a duplicate (convention §5). `400`
carries the refusal: a path that is not absolute or not a folder, a manifest
that does not load, a name another experiment already has.

**A start is checked first** (convention §7.5), on this route as on a click.
`CURRENT` answers `201` with a run that reads `STARTING`; `STALE` answers
`201` with one that reads `DEPLOYING` until the job's deploy is done (a failed
deploy leaves it `Error`); `CONFLICT` is a `400` carrying the check's reason,
and nothing is recorded. Each run in `GET /jobs/{name}` carries `deploy` —
what its check said, and when its deploy finished or why it failed. A start
made while that job is checking or deploying waits for it, within the wait of
§43.3.

The interface describes itself: `/help` names every route, so an agent can
discover the surface from the surface. It lives beside the routes in the code,
where the description and the behaviour cannot drift apart unnoticed.

**Locations, not contents.** Every caller is on this machine (§43.2), so a
detail response points at files — the experiment folder, a run's directory and
`run.json`, the report file when one exists — rather than carrying their
bytes. An agent reads those paths directly; the socket stays a control channel
and never becomes a file server.

A failed job run has a report too (convention §7.3.1), at the same
`location.report`, while its `status` stays `Failed`. When that report's
script failed, the run's `report_error` carries the script's output; it is
`null` otherwise, and always on the healthy path, where a failed report is the
run's own `error`. `report_running` is true while a run's report is due or
running.

**Re-running a report** takes the button's path (convention §7.3.2): the
report is marked due and the refresh tick runs it. The route answers **`202`
as soon as it is due**, not when it is done — a report script may run for the
whole ten-minute report timeout, which is longer than a write waits for the
engine (§43.3) and longer than the MCP binary waits for an answer:

```json
{ "run_id": "41", "report_running": true,
  "location": { "report": "/abs/solver-gpu/report/41.txt" },
  "follow": "/jobs/solver-gpu" }
```

Follow `GET /jobs/{name}` until that run's `report_running` is false; the
outcome is then on the run as on any report: `Succeeded`, or `Error` with its
`error`, on the healthy path; `Failed` with or without `report_error` for a
failed run. `404` names an experiment or run that is not there; `400` carries
the workbench's refusal — a run that cannot be reported, one whose report is
already running, or a Bench, whose own report is not re-run by hand. Who asked
is not recorded (convention §7.3.2). The MCP binary does not offer this route
as a tool yet.

A refusal carries the workbench's own text, unchanged — an agent reading it sees
what a person would have been shown — under the status that says who can act:
`404` for something that is not there, `400` for a request that was refused,
`503` when cocoa did not answer. A name asked for as the wrong kind is pointed at
the right route rather than flatly refused.

### 43.5 The MCP binary

`cocoa-mcp-server` serves this same surface as MCP tools (`cocoa_help`,
`cocoa_list_jobs`, `cocoa_job`, `cocoa_start`, `cocoa_register`, …) so an agent runtime speaks to
cocoa through its own tool protocol instead of raw HTTP. An agent's MCP client
launches the binary and speaks JSON-RPC over stdio; every tool call becomes
one request over the socket, and the socket's answers pass through verbatim.
It decides nothing — it is a translator, and the window must still be running
for it to answer. The MCP subset it needs (initialize, tools/list, tools/call,
one JSON message per line) is written out by hand rather than taken from an SDK.

Run with `--help-ai`, the binary prints a pointer instead of serving: one
paragraph on what cocoa runs, and the URL of the authoring convention
([authoring.md](authoring.md)) in both page and raw form. The document is
deliberately not baked in — it is versioned and reviewed in the repository
beside the code that enforces it, and a copy in the binary would hand an
agent whichever revision it happened to have installed. Live state still
comes only from the tools.

The binary is Rust and lives in its own crate, `cocoa-mcp/` — `cargo build`
there, and nothing else is needed: its only dependency is `serde_json`, and it
imports nothing from either workbench.

That independence is the design, not an accident of packaging. It speaks the
socket protocol of §43.2 and nothing else, and both implementations serve that
protocol identically, so it never had to know which cocoa was listening — it
drives the Electron workbench **unchanged**, which is why it outlived the
implementation it was written in. Its tests answer the socket with a stub for
the same reason: the boundary this crate owns is whether a tool call becomes the
right request and whether the answer returns as tool content, and tying that
test to a live engine would tie the one artifact meant to outlive both to
whichever one is currently alive.

It remains the repository's only Rust that is still developed. Porting it to
Node would remove the last build dependency on a Rust toolchain; nothing
requires that.

### 43.6 What is not here

No approval step and no separate notification: a run records who asked (§10.6),
and that record is where the question is answered. No authentication: the socket
is reachable only by processes that can open the file, and cocoa runs on the
user's own workstation. No cancel, no unregistration, and no event stream yet
— each is one route, one request variant, and one worker arm away when a real
agent needs it.

---
