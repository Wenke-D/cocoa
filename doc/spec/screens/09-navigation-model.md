# 9. Navigation Model

Use an explicit route union. A route is an **address, never content**: it names
what to show, and every fact on the page is looked up from the world by that
address at render time. A route must never carry a copy of a run.

```ts
// cocoa-electron/src/shared/ui.ts
export type ReportContext =
  | { kind: 'job_run'; job_id: string }
  | { kind: 'campaign_run'; campaign_id: string }
  | { kind: 'campaign_child'; campaign_id: string; campaign_run_id: string }

export type Route =
  | { page: 'empty' }
  | { page: 'entity'; entity_id: string }
  /** The start form (§15). Only the identity: what the user has typed is a
   *  draft held outside the route. */
  | { page: 'start'; entity_id: string }
  | { page: 'job_run'; job_id: string; run_id: string }
  | { page: 'campaign_run'; campaign_id: string; run_id: string }
  /** A run dispatched by a campaign, seen in the campaign's context (§19). */
  | { page: 'campaign_child'; campaign_id: string; campaign_run_id: string; run_id: string }
  | { page: 'report'; context: ReportContext; run_id: string }
```

Overlays are separate state, held by the renderer and never persisted:

```ts
// src/renderer/src/state.svelte.ts — `null` is "no overlay"; every overlay
// carries its own error and busy flag, because a modal that has asked for an
// operation has to show the refusal in place rather than dismiss into a toast.
export type Overlay = { error: string | null; busy: boolean } & (
  | { kind: 'confirmCancel'; target: CancelTarget }
  | { kind: 'confirmRemove'; entity_id: string }
)
```

§11.5's refusal-report modal is not in this union; see the gap noted there.

Do not encode modal state inside `Route`. A modal is an action, not a place: it
does not survive a relaunch and it is not a breadcrumb. (No route does —
every launch opens on the Explorer with nothing selected; architecture §32.)

## 9.1 Sidebar Navigation

Clicking a Job or Campaign in the sidebar must:

- Select that entity.
- Navigate to its overview.
- Clear any run-history row selection.
- Leave the sidebar visible.

## 9.2 Context Preservation

A run dispatched by a Campaign is reachable from two routes (§2.3.1). The route you
arrived by — not the run's origin — decides the context.

Reached from the Campaign run's dispatch table:

```text
Route:   CampaignChildRunDetail
Sidebar: Nightly Benchmark  (the Campaign stays selected)
Crumbs:  Nightly Benchmark / Run 2026-08-15 10:24 / Solver GPU
```

Reached from the Job's own ALL RUNS table:

```text
Route:   JobRunDetail
Sidebar: Solver GPU  (the Job is selected)
Crumbs:  Solver GPU / Run 2026-08-15 10:24
```

Both render the same run record. Navigating in one context must never silently
move the Explorer selection to the other.

## 9.3 Breadcrumbs

Every detail page must show clickable breadcrumbs.

Examples:

```text
Solver GPU / Run 2026-08-15 10:24
```

```text
Nightly Benchmark / Run 2026-08-15 10:24
```

```text
Nightly Benchmark / Run 2026-08-15 10:24 / Solver GPU
```

```text
Solver GPU / Run 2026-08-15 10:24 / Report
```

Each ancestor must be clickable.

A simple back arrow may additionally be shown, but breadcrumbs are the authoritative navigation.
