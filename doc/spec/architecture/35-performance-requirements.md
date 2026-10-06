# 35. Performance Requirements

The application must remain responsive with:

- 500 historical runs.
- A Campaign run that dispatched 50 concurrent child runs.
- Many simultaneously active runs across several Jobs.
- A report containing thousands of lines.
- A continuously updating duration field.

Avoid:

- Putting report text in the world (§10.5). Reports are fetched when opened, and
  refused above `MAX_REPORT_BYTES` rather than sent whole.
- Re-sorting large history arrays on every render where a derived value would do.
- A timer per run. One clock updates `now_ms`; durations are computed from it.
- Blocking the main process. It answers IPC, serves the agent socket, and runs
  the tick; a synchronous read of a large file there stalls all three.
- Re-bootstrapping to recover from a missed event. If events can be missed, the
  protocol is wrong (§26.3).

The world is re-sent as **entries**, never as a whole, after the first message.
This is the v1 protocol: entry-level over-push. It is sized for a local library
of tens of experiments, and the note on the v2 keyed protocol records what would
justify moving to it.
