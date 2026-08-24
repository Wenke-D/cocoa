# coco

A desktop workbench for experiments that live on your own machine.

An experiment is a **folder**: a `coco.toml` manifest and the scripts it names.
The manifest says how to launch a run, how to ask whether it is still going, how
to produce a report, and how to cancel it. coco runs those scripts and keeps
track of what came back. It does not know what a cluster is — your `launch.sh`
knows that.

coco keeps no database. A run is written into the experiment's own folder as
`runs/<id>/run.json`, and its report lands in `report/`. Your records are
ordinary files, next to the work that produced them, and they outlive the app.

![The workbench](doc/images/workbench-light.png)

```bash
cd coco-electron
npm install
npm run dev
```

**→ [Read the introduction](doc/coco.md)** for what coco is, what a Job and a
Bench are, and what using it looks like.

## The repository

| | |
|---|---|
| [`coco-electron/`](coco-electron/) | The workbench. Electron, Svelte 5, and a TypeScript engine in the main process. The only implementation under development. |
| [`coco-mcp/`](coco-mcp/) | The MCP server, so an agent can drive a running coco. Its own Rust crate, in continued use. |
| [`examples/`](examples/) | A library of small, real experiments to try it against. No cluster needed. |
| [`doc/`](doc/) | Everything below. |

## Documentation

| | |
|---|---|
| [coco.md](doc/coco.md) | **Start here.** What coco is and what it is for. |
| [screens.md](doc/screens.md) | What every page shows and how it behaves. |
| [architecture.md](doc/architecture.md) | How it is built, and which boundaries are load-bearing. |
| [convention.md](doc/convention.md) | The folder contract: manifests, records, the poll protocol. |
| [authoring.md](doc/authoring.md) | Writing a job or a bench: the guide to the contract above. |
| [agent.md](doc/agent.md) | The agent interface. |
| [ui-system.md](doc/ui-system.md) | The design system. |
| [developing.md](doc/developing.md) | Running it, testing it, and what is still outstanding. |

Sections throughout are numbered, and the source cites them by number: a comment
reading `(§2.3.1)` means the rule of that number. [doc/sections.md](doc/sections.md)
says which document holds which.

## Acknowledgement

`coco` is vibe-coded, designed and built with [Claude Code](https://claude.com/claude-code).
