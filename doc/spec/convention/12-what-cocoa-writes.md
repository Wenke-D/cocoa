# 12. What cocoa writes

To be exhaustive, inside a registered folder cocoa creates and maintains only:

- `runs/<run_id>/run.json` — the record;
- `runs/<run_id>/<rendered template>` — jobs, at launch;
- `runs/<run_id>/members.json` — benches, before a bench report;
- `report/` — the directory, created before a report script runs. Its
  **contents** are the script's.

Records are written atomically: temp file, then rename.

A launch that fails leaves its rendered artifact in place and writes no record
(§7.1) — the file is there for inspection, and the run id it was rendered under
is never reused (§5).

A malformed `run.json` fails **that run only**, which is shown as a broken row
carrying its error. It does not blank the folder's history — one corrupt file
must not hide hundreds of good runs.

cocoa never edits a script, a template, or a report.

## 12.1 Deleting a run

Deletion is the one operation that removes what cocoa wrote, and it is exact:
`runs/<run_id>/` goes whole — record, rendered artifact, `members.json` —
and so do `report/<run_id>.txt` and `report/<run_id>.html`. The folder's
other runs stay.

A fan-out is deleted whole, from the bench's side. A run a bench dispatched
cannot be deleted through its job — the refusal points at the bench run —
and deleting the bench run removes every member run it dispatched, each
from its own job's folder, along with the bench's own files. A member that
cannot be resolved (§9.2) has nothing left to delete and does not block the
rest. Deletion therefore never leaves half a fan-out behind: no bench
pointing at members that are gone, no member naming a bench that is.

Only a finished run can be deleted. An active run is refused — cancel is how
work stops — and so is `UNREACHABLE`: a run cocoa cannot see may still be
running, and deleting its record would be the one way to never find out. A
`FAILED` run whose report is still owed is refused until it lands (§7.3.1). A
bench run must be settled **and** every resolvable member finished, owed
reports included: a bench settles when one member fails (§9.1) while another
may still be running, and a running record is never deleted.

Because a run id is derived from the folder's own runs (§5), deleting the
newest run hands its id, and every id above what remains, back to the next
start. That is the deliberate consequence of having no counter beside the
disk; deleting from the middle frees nothing.
