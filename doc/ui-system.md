# UI system

How a screen in this application is built. The specification says *what* each
screen shows; this says *what to reach for* when drawing it.

> The first implementation was egui, and this document used to carry its
> module table and code examples (deleted 2026-08-22; in git history). The
> principles survived the move; the API below is the workbench's.

The rule behind everything: **a call site states a purpose, never an
appearance.** `var(--description)` rather than `#717171`, `<Button
variant="secondary">` rather than a `<button>` with its own padding. Two files
that spell the same appearance out by hand are two chances to get it subtly
different, and the drift is invisible until both are on screen at once.

## Where things live

| Place | Owns |
|---|---|
| `src/renderer/src/theme.css` | The palette, both schemes — the one place a colour is chosen — and cocoa's own chrome: body type, `table.runs`, `code` |
| `src/renderer/src/app.css` | Tailwind, and the shadcn names for cocoa's tokens: `bg-primary` *is* `--accent`, `bg-popover` *is* `--widget-bg`. No second palette |
| `src/renderer/src/lib/components/ui/` | shadcn-svelte's components — Button, Dialog, ContextMenu, Input, Label, Spinner, and for the Start form's shapes Select, Checkbox, Textarea (Separator rides along with Select). Copied-in source, owned and edited here, not a package |
| `src/renderer/src/lib/components/` | cocoa's own widgets: `ModalFrame`, `StatusPill`, `Breadcrumbs`, `RunFacts`, `Sidebar`, `StatusBar` |
| `src/renderer/src/pages/` | One component per page of the specification |

## Colour

The palette is VS Code's: Light Modern and Dark Modern, as CSS custom
properties on `:root`, the dark set under `prefers-color-scheme`. A caller
names a purpose and gets whatever colour that purpose owns:

```css
--editor-bg  --side-bar-bg  --status-bar-bg  --widget-bg   /* a region's own ground */
--foreground  --strong-foreground  --description           /* text, by weight of voice */
--accent  --on-accent  --link                              /* the one colour meaning "interactive" */
--row-hover  --row-selected  --row-selected-fg             /* a list row's ground */
--error  --warning                                         /* how loudly we are speaking */
--chart-*                                                  /* a run status */
--search-match  --search-match-current                     /* washes behind report text */
--code-bg  --code-inline-bg                                /* code's ground: a block, and a chip, heavier for being small */
```

The failure this prevents is not inventing a new shade — it is **borrowing** one
chosen for something else. A list's hover wash on a toolbar button, a chart's
amber as a warning: both look plausible, and both break the moment the theme
moves. `app.css` is where that discipline meets Tailwind: the components say
`bg-accent` and mean a hover tint, so `--color-accent` is mapped to
`--row-hover`, not to cocoa's `--accent`.

**Adding a colour** means adding a purpose in `theme.css`, in both palettes,
and saying what it means — then, if a utility class needs it, a line in
`app.css`. It never means a hex value at a call site, or a Tailwind colour
(`bg-blue-600`) that belongs to no palette.

## Type

The app is 13px Inter; `app.css` makes that what `text-sm` means, so the
components and the pages agree. Roles are named for what the text *is*, and
two roles that render identically today still get separate names when they
mean different things, so that either can change alone:

| Role | Where |
|---|---|
| Page title | `h1` in the page, 18–20px/600, `--strong-foreground` |
| Section heading | `h2` in the page, 13px/600, `--strong-foreground` |
| Eyebrow, panel header | 11px, letter-spaced, `--description`: `JOB`, `EXPLORER` |
| Caption, note | `--description` at body size |
| A value worth copying | `.mono` (`code`, run ids, parameters) |
| Status | `StatusPill` — label and colour chosen together, never colour alone (§23) |
| Feedback | `--warning` / `--error` text; the error callout is a bordered block |

## Controls

Buttons, inputs, dialogs and menus are the shadcn-svelte components. They own
their look, sized to cocoa's controls (28px buttons, 26px fields — edited in the
owned sources, noted at the top of each file).

```svelte
<Button>Start</Button>                                  <!-- the one primary action on a surface -->
<Button variant="secondary">Keep Running</Button>
<Button variant="ghost" size="icon-xs" aria-label="Refresh now"><RefreshIcon /></Button>
<Button disabled={busy}>{#if busy}<Spinner />Starting…{:else}Start{/if}</Button>
<Label><span class="text-description">{name}</span><Input bind:value /></Label>
```

A busy control is `disabled` with a `<Spinner />` in place of its icon or
before its label; the label says what is happening (`Cancelling…`). The modal
shell is `ModalFrame` over `Dialog`: focus trapped and restored, Escape and a
click outside dismiss it — unless it is busy, when nothing does. The Explorer's
row menu is `ContextMenu` around each row: keyboard-navigable, closed with the
row it belongs to.

Link-styled buttons (`View report`, a breadcrumb, `Dismiss`) stay plain
`<button>`s styled in place: they are text that happens to act.

## Layout

A page is scoped CSS in its own component, on the tokens. Tailwind utilities
are for composing the components and for one-off placement next to them
(`ml-auto`, `mt-3`); a page's own layout is written as CSS, where a rule can
carry a comment saying why.

- **Facts** go in a `<dl>` grid, labels in `--description`; `RunFacts` is the
  shared one.
- **A history** is `table.runs`: fixed layout, declared column widths, the
  remainder column last (§22). The rule is global in `theme.css` because it was
  on its third copy.
- **Empty states** are a heading and a sentence in `--description`; they must
  never look like errors (§12).
- **Spacing**: 4 / 8 / 16 / 24 — between a label and its field, between rows,
  between sections, around a page.

## Drawing a new screen

1. Identity first: the eyebrow for the kind, `h1` for the name.
2. Break the body into `h2` sections. One action per section at most.
3. Facts go in a `<dl>`; a list of runs is `table.runs`.
4. Something the reader must notice: a bordered callout in `--warning` or
   `--error`. Something they may skip: a line in `--description`.
5. Actions are `<Button>`s; at most one primary per surface.
6. Reach for margin only between sections. Inside one, the widget owns its
   spacing.

Then look at it: `npm run drive scripts/scenarios/<name>.mjs` in
`cocoa-electron/` runs the built app and leaves screenshots in `.drive/shots/`
(developing.md, "Driving the built app"). Add a scenario there rather than
checking a new screen by eye.

## Invariants

- No colour outside `theme.css`. A Tailwind colour that is not one of the
  mapped names is a colour from nowhere.
- No bare `11px`, no bare `#RRGGBB` invented at a call site: sizes and colours
  are the tokens', and the scales above.
- A role that renders like another is still its own role. Merge them only when
  they mean the same thing, never because they happen to match.
- The components under `lib/components/ui/` are edited, not wrapped: a change
  to how every button looks is a change in `button.svelte`, once. Re-adding a
  component from the registry overwrites it, so each edited file says so at
  the top.
