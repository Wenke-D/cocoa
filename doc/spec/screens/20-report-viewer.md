# 20. Report Viewer

Reports come in two formats, and the application controls neither their content
nor their styling (convention §11):

```text
Plain text   the quick answer — shown on the run's page itself (§17.5)
HTML         the long read — rendered here, in a sandboxed frame
```

The viewer is where an HTML report is read: the run page's `Open` leads here.
A plain-text report is not opened at all — it is on the run's page already —
and reaches the viewer only as an HTML report's source does, as text (§20.3).
A plain-text address still opens, as text, should one be restored from an
earlier session.

An experiment writes whatever report it writes. Two HTML reports from two
experiments may share no styling at all, and any in-app approximation of them
would misrepresent them — so cocoa does not approximate. It renders the file.

The renderer is a browser engine, which is what makes this possible; the egui
implementation had to hand an HTML report to the system browser instead, and
§5.1 named exactly this as the thing that would re-open the framework question.
It did.

**The frame is the boundary.** The body goes into an `<iframe>` by `srcdoc`,
with `sandbox="allow-scripts"` and nothing else. `allow-scripts` is granted so
that a charting report — the common case for a benchmark — works at all.
`allow-same-origin` is deliberately withheld: without it the frame is an opaque
origin, so the report cannot reach cocoa's storage, its DOM, or `window.cocoa`.
A report is a file some experiment's script wrote, and it is treated as
untrusted input, not as part of the application.

The report's text is not part of the world (§10.5). The viewer asks for it by
run, and the read happens then, so a file deleted or broken since the last tick
raises its error at the moment the user asks to see it.

The viewer opens in the full main-content area.

## 20.1 Header

Show:

- Breadcrumbs.
- Report title.
- Run ID or human-readable run time.
- `Source` / `Rendered` toggle, for an HTML report.
- Copy button.
- Wrap Lines toggle, while text is shown.

There is no `Open in Browser`: the report renders here, in full.

## 20.2 Search

Provide:

- Search input.
- Match count.
- Previous match.
- Next match.

P0 does not require advanced syntax or regex.

Search is case-insensitive by default.

Exact visual text highlighting is optional, but match counting must work.

## 20.3 Text Body

An HTML report's source, or a plain-text report addressed directly.

Requirements:

- Read-only.
- Selectable.
- Monospace.
- Vertically scrollable.
- Supports very long lines.
- Wrap toggle, off by default.
- Does not edit backend data.

With wrapping off, rows are uniform height, so only visible rows need laying
out. A report of several thousand lines must stay responsive (§35).

Do not display the report inside a small modal.

## 20.5 HTML Body

The page renders the report whole, in the sandboxed frame described above,
taking the full main-content area; the report scrolls inside it. `Source`
swaps the frame for the file's text (§20.3), so search and copy work on an
HTML report too, and `Rendered` swaps it back.

Do not render a subset of HTML, or restyle it. A partial rendering of an
unknown stylesheet looks like a broken report, not a simplified one: the frame
renders the file as the browser engine would anywhere else.

## 20.4 Copy

`Copy` copies the complete report text to the clipboard.

Show a small temporary confirmation such as:

```text
Report copied.
```
