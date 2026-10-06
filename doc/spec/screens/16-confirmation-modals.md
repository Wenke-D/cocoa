# 16. Cancel and Delete Confirmation Modals

Cancel is destructive and requires confirmation.

## 16.1 Job Copy

```text
Cancel this Job run?

Solver GPU
Started at 10:24:31
Running for 6 minutes.

The cancellation operation defined by the manifest
will be requested.

Keep Running                         Cancel Run
```

## 16.2 Bench Copy

```text
Cancel this Bench run?

Nightly Benchmark

All 4 runs still active will be cancelled.
2 runs have already finished and keep their results.

Runs of the same Jobs started outside this Bench
are not affected.

Keep Running                       Cancel Bench
```

## 16.3 Behavior

After confirmation:

1. Close the confirmation modal.
2. Set status to `Cancelling`.
3. Keep the user on the current detail page.
4. After the mock transition, set status to `Cancelled`.
5. If the mock operation fails, restore the prior status and display an error.

Never immediately label a run `Cancelled` before the cancellation transition completes.

## 16.4 Deleting a Run

Deletion is the one operation that cannot be taken back: cancel stops work,
remove forgets a folder, delete destroys the record. It removes from disk
everything the run left behind — `runs/<id>/` whole, and its `report/<id>.*`
files — and nothing else (convention §12.1).

Where it is offered:

- On a run's detail page, in the place Cancel occupies while the run is
  active — the stop icon becomes the trash icon; a run is either stoppable
  or deletable, never both.
- In the history's row menu (§22.6), as `Delete…` after a separator, in the
  destructive colour, disabled where deletion is not allowed.

Only a **finished** run can be deleted. An active run must be cancelled
first, and the cancellation must land; `UNREACHABLE` is refused too — a run
cocoa cannot see may still be running, and deleting its record would be the
one way to never find out. A `Failed` run whose report is still `Generating`
offers no Delete until the report lands (convention §12.1).

**A fan-out is deleted whole, from the bench's side.** A run a bench
dispatched offers no Delete anywhere — not on its page, not in the job's
history row — and the engine refuses it whatever the UI shows, pointing at
the bench run. Deleting the bench run takes every run it dispatched with
it, and requires each resolvable member to be finished itself, since a
bench can settle while a member still runs (§9.1 of the convention). So
deletion never leaves half a fan-out: no bench pointing at members that
are gone, no member naming a bench that is.

The click asks first, always — that modal is the second confirmation. Its
copy speaks the user's language, never cocoa's file names: the run
disappears from the history forever, its report goes with it — for a bench
run, the runs it dispatched too — and `This cannot be undone.` The confirm
button wears the destructive colour and never a neutral one.

On success the run is gone from every table before the modal closes (the
events ride the same answer), the transient message says `Run N deleted.`,
and a page that was looking at that run — its detail page, or its report —
steps back to the experiment's overview. A refusal keeps the modal open with
the reason.

One consequence is stated rather than hidden: a run id is derived from what
is on disk (convention §5), so deleting the newest run hands its id — and
every id above what remains — back to the next start. Deleting from the
middle frees nothing.
