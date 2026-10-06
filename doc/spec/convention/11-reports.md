# 11. Reports

On the healthy path, report progress is part of the status axis, not a second
one: `COMPLETED` → `ANALYZING` → `SUCCEEDED` *is* the report lifecycle, and a
report script that fails leaves the run at `ERROR` with its output attached.
That `ERROR` is the one healable case: fixing the script and re-running report
by hand moves the run to `SUCCEEDED` — the cluster had already said
`COMPLETED`, and `SUCCEEDED` is cocoa's word for finished *and* reported
(§7.3).

The one report off that axis is a `FAILED` run's. Its status is already
terminal and is the cluster's to set, so its report keeps its own state —
owed, landed, failed — in the record's `report` field (§7.3.1).

It follows that:

- a succeeded run always has `report/<run_id>.txt`;
- a `FAILED` run has one once its report has landed — not while it is owed,
  not when its script failed, and not if it was `FAILED` before 2026-10-06
  until someone reports it by hand;
- a `CANCELLED` or `ERROR` run has no report;
- `report/<run_id>.html` is optional and may accompany the text one.

The UI offers one open action per format that exists — the HTML one appears
only when that file is there. Plain text renders in the app; HTML is handed to
the system browser, the only thing that renders it faithfully.
