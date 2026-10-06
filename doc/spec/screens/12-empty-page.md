# 12. Empty Page

The main region's page when no experiment is selected — the front door:
every launch lands here (architecture §32), so it is seen daily and must
stay calm at the thousandth viewing.

It is a **centred brand moment**, not a note in a corner: the app's mark
above the wordmark `cocoa`, together at the optical centre of the main
region, and one line of state hanging beneath them. The Explorer still
holds the next action — the line points there — but the daily open earns
a moment of identity before the work starts. Everything else about the
page's restraint stands: no enclosing panel, no shadow, no decorative
divider. The mark is the exception to "no illustration", and only
because it is not one: it is the same object the dock shows, at 76px,
inline from `build/icon.svg` and painted from `--mark-tile` /
`--mark-bean` — the one pair identical in both schemes, because an icon
that re-tints per theme is a different icon.

Below it the wordmark: lowercase `cocoa`, 42px/1 semibold,
letter-spacing −0.02em, 18px under the mark, in the **ordinary text
colour** — the mark carries the brand's colour, so the word does not
have to, and a second coloured element beside it would be two things
competing to be looked at first. Neither is selectable. The pair sits in
the middle row of a 1fr / auto / 1.618fr grid, the golden section (~38%
down), and does not move between states; only the line under it changes,
with no transition. State lines are 14px/22 in the muted colour, centred,
max-width 460px, 18px below the wordmark. This page alone escapes the
900px reading column: it centres in the whole visible region.

**Starting** — the backend has not answered yet. An inline 14px
`LoaderCircle` leads the line, turning once per 1600ms (static under
reduced motion); the state is a polite live region marked busy.

```text
            ▣
          cocoa
⟳ Reading registered experiment folders.
```

**No experiments registered** — an ordinary absence, never an error: no
warning treatment, no alert role. The button is now the only accent on
the page, and opens the operating system's folder picker (§11.5).

```text
                          ▣
                        cocoa
No experiments are registered. Add a folder that contains
              a valid experiment manifest.

                    [Add Folder]
```

**Experiments exist, none selected** — the state seen every day. Below
the line, at a distance (28px), an at-a-glance line: 12px muted, tabular
numerals, not clickable, no badges or status colours. Zero-value segments
stay, so the line keeps one shape from launch to launch; screen readers
hear commas rather than the middle dots. When both counts are zero this
state never shows — the previous one does.

```text
                    ▣
                  cocoa
Select an experiment in the Explorer to begin.

       2 campaigns · 4 jobs · 1 active run
```
