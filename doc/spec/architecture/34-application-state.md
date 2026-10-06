# 34. Application State

Domain state and application state are separate, and they live in separate
processes — which is the strongest form of that separation available.

The renderer's whole mutable state is one rune:

```ts
// src/renderer/src/state.svelte.ts
export const app = $state({
  connected: false,
  world: emptyWorld() as World,     // a mirror; only events write it
  route: { page: 'empty' } as Route,
  overlay: null as Overlay | null,  // never persisted (§9)
  notice: null as Notice | null,
  journal: [] as JournalEntry[],    // what happened, as this side phrased it (§11.1)
  sidebar_width: ...,                // layout, persisted (§32)
  sidebar_view: ..., sidebar_open: ..., // session only: a launch opens on the Explorer
  report_wrap: ...,
  now_ms: Date.now()                 // the clock durations tick off
})
```

`world` is a **mirror, not a source**. Only `cocoa:bootstrap` and `cocoa:events`
write it. No component may edit it to reflect an action it just took — the
action's events are what update the screen, and they arrive before the action's
answer resolves (§26.3).

There is exactly one `notice`: the newest thing to say is the thing worth
saying, and a stack of them is the verbose log §8.5 rules out.

Do not let route changes modify execution state.

Do not let a refresh reset route state. A refresh may *invalidate* a route — the
entity was removed, the run is gone — and then it is recovered explicitly, with
a message (§32), never silently.
