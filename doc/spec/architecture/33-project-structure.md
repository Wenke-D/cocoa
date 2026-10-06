# 33. Project Structure

```text
cocoa-electron/
├── package.json
├── electron.vite.config.ts        # three builds: main, preload, renderer
├── electron-builder.yml
├── vitest.config.ts
├── svelte.config.mjs              # preprocess; `kit.alias` only for the shadcn-svelte CLI
├── components.json                # the shadcn-svelte CLI's config: where components go
├── tsconfig.node.json             # main + preload
├── tsconfig.web.json              # renderer
│
├── src/
│   ├── shared/                    # both sides import these; one definition
│   │   ├── world.ts               #   domain types + the IPC protocol (§10, §26.3)
│   │   ├── params.ts              #   a parameter's shape, the one value check, the wire form
│   │   ├── maybe.ts               #   present-or-absent, so nothing turns on `undefined`
│   │   └── error.ts               #   what a failure looks like on the wire
│   │
│   ├── main/                      # the server: owns everything
│   │   ├── index.ts               #   the process's lifetime: ready, quit, and nothing else
│   │   ├── boot.ts                #   what this launch is: its profile, window, platform
│   │   ├── runtime.ts             #   the engine and the notice gate — the two singletons
│   │   ├── store_path.ts          #   where store.json lives, and the move that got it there
│   │   ├── env.ts                 #   env vars: set-but-empty is absent
│   │   ├── log.ts                 #   how the process prints
│   │   ├── engine/                #   the domain — no Electron import anywhere
│   │   │   ├── index.ts           #     the engine proper: Engine, and the refresh tick
│   │   │   ├── memory.ts          #     the in-memory truth, written through to folders
│   │   │   ├── job.ts             #     start / poll / report / cancel (§7)
│   │   │   ├── campaign.ts           #     plan / start / report / cancel / status (§8, §9)
│   │   │   ├── in_flight.ts       #     launch scripts not yet answered (§7.1)
│   │   │   ├── manifest.ts        #     cocoa.toml, fully validated
│   │   │   ├── params.ts          #     what a start must supply, checked the same on every way in
│   │   │   ├── template.ts        #     analyze / render (§15.2)
│   │   │   ├── invoke.ts          #     lexical command split, spawn
│   │   │   ├── record.ts          #     run.json, byte-compatible
│   │   │   ├── status.ts          #     the poll protocol (§10.2)
│   │   │   ├── store.ts           #     store.json, atomic writes
│   │   │   ├── words.ts           #     the protocol's vocabulary
│   │   │   ├── world.ts           #     folders → World
│   │   │   ├── delete.ts          #     removing a run, and what that may not touch
│   │   │   └── errors.ts
│   │   ├── bridge/                #   everything the renderer is told or may ask for
│   │   │   ├── ipc.ts             #     the handlers: call an operation, publish, answer
│   │   │   ├── operations.ts      #     the asks as plain functions over the engine (§26)
│   │   │   ├── publish.ts         #     the model, and turning its changes into events
│   │   │   ├── sync.ts            #     diff_worlds — the backend judges change (§26.3)
│   │   │   ├── refresh.ts         #     the tick
│   │   │   └── notices.ts         #     announce once, then hold still (§26.4)
│   │   ├── shell/                 #   the desktop app around the server
│   │   │   ├── window.ts          #     the window: making it, sending to it, its geometry
│   │   │   ├── window_state.ts    #     how the window was left (§32)
│   │   │   ├── window_state_file.ts #   that state's trip through disk
│   │   │   └── menu.ts            #     the platform's minimum: Edit roles + Quit
│   │   └── agent/                 #   the unix socket (§43)
│   │       ├── serve.ts           #     the socket's lifecycle
│   │       ├── app.ts             #     the Express route table
│   │       ├── reads.ts           #     the GET answers
│   │       ├── start.ts           #     the POST answer
│   │       ├── help.ts            #     the self-description
│   │       └── answer.ts          #     AgentDeps, AgentResponse
│   │
│   ├── preload/index.ts           # the typed bridge — the page's whole vocabulary
│   │
│   └── renderer/                  # the client: renders, asks, holds nothing
│       ├── index.html
│       └── src/
│           ├── main.ts
│           ├── App.svelte
│           ├── state.svelte.ts    #   the one rune (§34)
│           ├── ui_state.ts        #   Route, UiState, sanitize (§9, §32)
│           ├── journal.ts         #   what happened, in a sentence, from each event (§11.1)
│           ├── theme.css          #   the palette and cocoa's chrome (ui-system.md)
│           ├── app.css            #   Tailwind; shadcn's names for theme.css's tokens
│           ├── lib/
│           │   ├── utils.ts       #   `cn()` and the prop types the components import
│           │   └── components/    #   ActivityBar; Sidebar hosting Explorer, ActiveRuns,
│           │       │              #   Events under a ViewTitle; StatusBar, StatusPill,
│           │       │              #   Breadcrumbs, ModalFrame, CancelModal, RemoveModal,
│           │       │              #   RunFacts
│           │       └── ui/        #   shadcn-svelte: Button, Dialog, ContextMenu,
│           │                      #   Input, Label, Spinner, Select, Checkbox,
│           │                      #   Textarea — copied-in, owned source
│           └── pages/             #   Empty, EntityOverview, StartRun,
│                                  #   JobRunDetail, CampaignRunDetail,
│                                  #   CampaignChildRunDetail, ReportViewer
│
├── scripts/drive.mjs + scenarios/ # drive the built app (§28)
└── tests/                         # vitest (§37)
    └── fixtures/                  #   the two folders the suites copy and drive
```

Beside it in the repository:

```text
cocoa-mcp/         the MCP server (§43.5) — one binary, serde_json, nothing else
examples/         the demonstration library: real experiments, no cluster needed
doc/manual/       the user manual: the overview, and writing a job or a campaign
doc/spec/         the development specification: one file per section, a folder per area
```

Two boundaries are structural rather than stylistic, and must hold:

1. **`src/main/engine/` imports nothing from Electron.** It is the domain over a
   filesystem, and that is what makes it testable against real temp folders with
   no app around it, and portable between the two implementations.
2. **`src/renderer/` imports nothing from `src/main/`.** Its only channel is
   `window.cocoa` (§5). If the renderer needs a fact, the fact belongs in the
   world or in an operation's answer.

`RunFacts.svelte` exists because a dispatched run has two addresses (§2.3.1,
§19): the job-run page and the campaign-child page show the same record, so the
facts come from one component and cannot drift.
