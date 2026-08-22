# UI system

How a screen in this application is built. The specification says *what* each
screen shows; this says *what to reach for* when drawing it.

> **Which implementation this describes.** The principles below — a call site
> states a purpose rather than an appearance, the colour roles, the type scale,
> the spacing steps — are the design system, and the workbench in
> `coco-electron/` implements them in `src/renderer/src/theme.css` as CSS custom
> properties and utility classes. The **module table and code examples are
> egui's**, from the first implementation (deleted 2026-08-22; in git history),
> and have not been rewritten for the workbench.
> Read them as the reference statement of each rule, not as the API to call.

The rule behind everything below: **a call site states a purpose, never an
appearance.** `text::caption(…)` rather than `.weak().small()`,
`theme::control(ui, Hover)` rather than `palette.secondary_hover_bg`. Two files
that spell the same appearance out by hand are two chances to get it subtly
different, and the drift is invisible until both are on screen at once.

## Where things live

| Module | Owns |
|---|---|
| `ui::theme` | The palette, the metrics, and the egui `Style` the whole app inherits |
| `ui::text` | The type scale — every text role, by name |
| `ui::widgets::section` | A titled block of content |
| `ui::widgets::surface` | Cards, callouts, notices |
| `ui::widgets::form` | Label-and-value rows on a shared column |
| `ui::widgets::button`, `widgets::icon_button` | The two ways to offer an action |
| `ui::space` | The spacing scale: `SMALL` 4, `NORMAL` 8, `SECTION` 16, `PAGE` 24 |

## Colour

`Palette`'s fields are private. There is no way to name a colour from outside
`theme`; a caller names a purpose and gets whatever colour that purpose owns:

```rust
theme::surface(ui, Surface::SideBar)        // a region's own ground
theme::ink(ui, Ink::Strong)                 // text and glyphs
theme::icon(ui, IconState::Active)          // an icon's two weights
theme::row(ui, RowState::Selected)          // a list row's ground → Option
theme::row_ink(ui, RowState::Selected)      // and the text on it
theme::control(ui, ControlState::Hover)     // buttons and toolbar icon buttons
theme::feedback(ui, Level::Warning)         // how loudly we are speaking
theme::highlight(ui, Highlight::FindMatch)  // washes behind report text
theme::accent(ui)                           // the one colour meaning "interactive"
theme::status_style(dark, display)          // a run status: colour + marker fill
```

The failure this prevents is not inventing a new shade — it is **borrowing** one
chosen for something else. A list's hover wash on a toolbar button, a chart's
amber as a warning: both look plausible, and both break the moment the theme
moves.

**Adding a colour** means adding a purpose here — a new enum variant, or a new
function — and saying what it means. It never means reaching for a token that
looks close enough.

## Type

Roles are named for what the text *is*. Two roles that render identically today
still get separate names when they mean different things, so that either can
change alone.

| Role | Use |
|---|---|
| `text::eyebrow` | The type label above a title: `JOB`, `START BENCH` |
| `text::section` | A section heading inside content: `ACTIVE RUNS` |
| `text::panel_header` | A panel or menu title: `EXPLORER`, `BENCHES` |
| `text::panel_header_paint` | The same, for a painter that has no `RichText` |
| `text::caption` | Hints, notes, anything the reader may skip |
| `text::muted` | A quiet line at body size |
| `text::strong` | The line in a block that carries its identity |
| `text::mono` / `text::mono_muted` | Values worth copying; a field's name |
| `text::table_header` | A column header |
| `text::none` | The em dash a cell shows when a value does not apply |
| `text::status` / `status_strong` | A run status — label and colour chosen together |
| `text::warning` / `text::error` | Feedback text |
| `text::chrome_note` | A quiet line in the sidebar |

`text::status` exists so that no call site can pair `Succeeded` with the colour
of `Failed`: the label and the colour come out of one decision. Colour is never
the only signal — the label is always present (specification §23).

## Layout

**A titled block** — `Section`. The heading, an optional note beside it, an
optional action at its right edge, and the spacing between all of them:

```rust
Section::new("ACTIVE RUNS").show(ui, |ui| { … });          // heading + body

Section::new("PARAMETERS")                                  // the modal form
    .note("(all required)")
    .rule(false)                    // a modal's sections are too close for rules
    .enabled(!submitting)
    .show(ui, |ui| { … });

Section::new("OVERVIEW").show_heading(ui);                  // long page: no closure
```

`show_heading` exists because a detail page is a long run of sections, and
wrapping each in a closure would indent the whole page for nothing.

**Blocks that stand apart** — `surface`, in three volumes:

```rust
surface::card(ui, |ui| …);                            // a unit the reader scans
surface::callout(ui, theme::Level::Warning, |ui| …);  // tinted, bordered
surface::notice(ui, "…");                             // a quiet line, no ground
```

**Label-and-value rows** — `form`, in two voices:

```rust
form::grid(ui, "run_overview", |form| {      // facts: prose labels, page spacing
    form.row("Run ID", |ui| parameter_block::inline(ui, run.id.as_str()));
});

form::fields(ui, "start_parameters", |form| { // inputs: mono labels, modal spacing
    form.row(name, |ui| { ui.add_enabled(!submitting, TextEdit…); });
});
```

**Actions** — `Button::primary` / `Button::secondary` for worded actions, at most
one primary per surface; `widgets::icon_button` where a worded button would
crowd the row it sits in. Both carry their own hover and held states, so an icon
action in a table behaves exactly like one in a title row.

## Drawing a new screen

1. Identity first: `text::eyebrow` for the kind, `ui.heading` for the name.
2. Break the body into `Section`s. One action per section at most.
3. Facts go in `form::grid`; a unit that is scanned rather than read goes in
   `surface::card`.
4. Something the reader must notice: `surface::callout` with a `Level`. Something
   they may skip: `surface::notice`.
5. Empty states use `widgets::empty_state` — they must never look like errors
   (specification §12).
6. Reach for `add_space` only between sections. Inside one, the widget owns its
   spacing.

Then look at it: `npm run drive scripts/scenarios/<name>.mjs` in
`coco-electron/` runs the built app and leaves screenshots in `.drive/shots/`
(developing.md, "Driving the built app"). Add a scenario there rather than
checking a new screen by eye.

## Invariants

- No `RichText` modifier chains outside `ui::text`. The exceptions are widgets
  colouring themselves from their own state — a status badge, a breadcrumb, the
  primary button — and they are exceptions because the state is theirs.
- No colour outside `ui::theme`. The compiler enforces this.
- No bare `11.0`, no bare `#RRGGBB`, no `Margin::same(20)` invented at a call
  site. Metrics live in `theme::metrics`, spacing in `ui::space`.
- A role that renders like another is still its own role. Merge them only when
  they mean the same thing, never because they happen to match.
