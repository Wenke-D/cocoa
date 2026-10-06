# cocoa

A desktop workbench for experiments that live on your own machine.

An experiment is a **folder**: a `cocoa.toml` manifest and the scripts it names.
The manifest says how to check that what a run needs is in place and deploy it
when it is not, how to launch a run, how to ask whether it is still going, how
to produce a report, and how to cancel it. cocoa runs those scripts and keeps
track of what came back. It does not know what a cluster is — your `launch.sh`
knows that.

cocoa keeps no database. A run is written into the experiment's own folder as
`runs/<id>/run.json`, and its report lands in `report/`. Your records are
ordinary files, next to the work that produced them, and they outlive the app.

![The workbench](doc/manual/images/workbench-light.png)

```bash
cd cocoa-electron
npm install
npm run dev
```

**→ [Read the overview](doc/manual/overview.md)** for what cocoa is, what a Job and a
Bench are, and what using it looks like.

## The repository

| | |
|---|---|
| [`cocoa-electron/`](cocoa-electron/) | The workbench. Electron, Svelte 5, and a TypeScript engine in the main process. The only implementation under development. |
| [`cocoa-mcp/`](cocoa-mcp/) | The MCP server, so an agent can drive a running cocoa. Its own Rust crate, in continued use. |
| [`examples/`](examples/) | A library of small, real experiments to try it against. No cluster needed. |
| [`doc/`](doc/) | The user manual and the development specification, below. |

## Documentation

The documentation comes in two parts.

### User manual — [`doc/manual/`](doc/manual/)

For using cocoa and writing experiments for it.

| | |
|---|---|
| [overview.md](doc/manual/overview.md) | **Start here.** What cocoa is, what a Job and a Bench are, and what using it looks like. |
| [authoring.md](doc/manual/authoring.md) | Writing a job or a bench: the folder, the manifest, the six scripts. |

### Development specification — [`doc/spec/`](doc/spec/)

For working on cocoa itself: what it must do, how it is built, and the
contracts it keeps.

| | |
|---|---|
| [product.md](doc/spec/product.md) | The mission, the product model, the core operations, and the scope. |
| [screens.md](doc/spec/screens.md) | What every page shows and how it behaves. |
| [architecture.md](doc/spec/architecture.md) | How it is built, and which boundaries are load-bearing. |
| [convention.md](doc/spec/convention.md) | The folder contract: manifests, scripts, records, statuses. Normative; authoring.md is its guide. |
| [agent.md](doc/spec/agent.md) | The agent interface: the socket, its routes, and the MCP binary. |
| [ui-system.md](doc/spec/ui-system.md) | The design system. |
| [developing.md](doc/spec/developing.md) | Running it, testing it, and what is still outstanding. |

Sections throughout are numbered, and the source cites them by number: a comment
reading `(§2.3.1)` means the rule of that number.
[sections.md](doc/spec/sections.md) says which document holds which.

## Acknowledgement

`cocoa` is vibe-coded, designed and built with [Claude Code](https://claude.com/claude-code).
