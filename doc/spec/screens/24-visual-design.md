# 24. Visual Design

The visual style should be:

- Professional.
- Dense but readable.
- Desktop-oriented.
- Similar in information density to an IDE or developer tool.
- Minimal.
- Free of decorative gradients.
- Free of large marketing-style cards. What belongs together — a run's facts, a history, a form — sits in a **panel**: white (or the dark scheme's raised brown) on the warm page, a hairline edge, an 8px corner and a shadow barely there. A panel is dense inside; it groups, it does not present.
- Free of excessive rounded corners: 8px on a panel, 4–6px on a control, and a status chip's ends round.
- Free of unnecessary animation.
- Warm, not pale. A page of grey on white said nothing about what was on it. Colour is spent on meaning — what kind of experiment, what state a run is in, what can be clicked — and the frame carries the product's own brown, so the window is recognisably cocoa before anything in it is read.

## 24.1 Hierarchy

Use:

- Large page title.
- Small uppercase type label.
- Section headings.
- Subtle separators.
- Compact status pills.
- Monospace text for parameters, IDs, paths, and reports.

## 24.2 Spacing

Use an approximately 8-point spacing system.

Suggested values:

```text
Small gap: 4
Normal gap: 8
Section gap: 16
Large page gap: 24
Card padding: 10–12
```

## 24.3 Theme

Default to the operating-system theme.

Provide a three-way choice in the activity bar's gear menu (§8.2), under a `Color Theme` heading:

```text
System
Light
Dark
```

The choice persists across launches. No custom theme editor is required.

The palette is the product mark's (§12). Light is milk chocolate, dark is dark chocolate:

| Role | Light | Dark |
|---|---|---|
| Frame (activity bar, status bar) | cocoa brown `#3a2a20`, cream text | near-black brown `#110d0a`, cream text |
| Sidebar ground | latte `#f3ece3` | `#171310` |
| Page ground | warm paper `#faf7f3` | `#1c1714` |
| Panel | white | `#241e1a` |
| Accent — primary action, selection, links, focus | caramel `#b0541a` | `#e0894a`, with dark text on it |
| Kind — job / campaign | teal `#2c7a83` / plum `#8b4aa3` | `#5bbcc6` / `#c592de` |

Status colours stay cool and saturated — blue, green, red, amber, grey — so a run's state is never mistaken for the brand's warmth. The kind hues are ones no status uses, so a kind is never read as a state. The layout metrics (28px controls, 22–26px rows, 48px activity bar) remain VS Code's, and so do the token names where VS Code has one (`--editor-bg`, `--side-bar-bg`); the values are cocoa's own.

Each status carries a separate light and dark value rather than one value reused across both themes (§23). Native parts — scrollbars, a native checkbox — follow the scheme too (`color-scheme: light dark`).

## 24.4 Path Display

Use:

```text
~/Experiments/solver-gpu
```

rather than platform-specific absolute mock paths.

Full path text must be selectable.
