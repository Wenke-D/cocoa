# 21. Global Active Runs Indicator

The active-run count appears in two places, and both update automatically:

- The activity bar's `Active Runs` badge (§8.2).
- The bottom status bar, worded `No active runs`, `1 active run`, or `N active runs` (§8.5).

A Campaign run counts once, not once per dispatched child, so a fifty-call sweep reads as one thing the user started.

The list itself is the `Active Runs` sidebar view (§11.1), not a popup. It is persistent and non-modal, reached from the badge's own icon, and each row navigates to the run's detail page — where the run's duration, progress, and Cancel action already live.

```text
ACTIVE RUNS

Nightly Benchmark              Running
Solver GPU                     Running
```
