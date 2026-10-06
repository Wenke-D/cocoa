# 24. Visual Design

The visual style should be:

- Professional.
- Dense but readable.
- Desktop-oriented.
- Similar in information density to an IDE or developer tool.
- Minimal.
- Free of decorative gradients.
- Free of large marketing-style cards.
- Free of excessive rounded corners.
- Free of unnecessary animation.

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

The palette and metrics follow Visual Studio Code's two built-in default themes — **Light Modern** and **Dark Modern**. Palette token names match VS Code's `workbench.colorCustomizations` keys, so any value can be checked against the upstream theme file.

Each status carries a separate light and dark value rather than one value reused across both themes (§23).

## 24.4 Path Display

Use:

```text
~/Experiments/solver-gpu
```

rather than platform-specific absolute mock paths.

Full path text must be selectable.
