# 23. Status Presentation

Use both text and visual indicators.

Do not rely on color alone.

A status is shown as a **chip**: a dot and the word on a wash of the
status's colour, the word in that colour mixed toward the strongest text so
it keeps its hue and stays legible on the wash in both schemes. A run page
leads with a **status tile** (§17.1): a 44px square on the same wash,
carrying a sign — a check for good, a cross for bad, a warning triangle for
`Unknown`, a ban for `Cancelled`, a turning circle for everything under way
(held still under reduced motion).

The one place the word is not printed is a history table (§22), where the
status is its dot alone, ringed in its own wash, leading the row in a narrow
column of its own with no heading, the run id beside it. Read down that column, the five colours
are the five outcomes a history is scanned for, and the word is the dot's
hover text and its accessible label. What the dot does not tell apart — `Failed` from
`Error`, both red; `Queued`, `Running` and `Cancelling`, all pulsing blue —
the detail page does, one click away, as does the Active Runs view for
anything live.

Recommended semantics:

```text
Deploying     neutral/blue animated or pulsing indicator
Starting      neutral/blue animated or pulsing indicator
Pending       muted
Running       blue
Succeeded     green
Failed        red
Cancelling    amber
Cancelled     gray
Unknown       amber/question indicator
```

Avoid emoji whose rendering varies across operating systems.

Prefer:

- Painter-drawn circles.
- Simple check or cross glyphs.
- Text labels.

Status colors must remain legible in both dark and light themes.
