# 10. When cocoa cannot see a run

Execution failure and query failure are different facts. A run cocoa cannot
currently see is not a run that failed, and `UNREACHABLE` exists so that the
difference survives: it sits on the same status axis, but it is **not terminal**
and it does not end anything.

A poll that cannot reach its scheduler says so and exits **0** — it did its
job; the scheduler is the problem:

```
COCOA_RETURN: UNREACHABLE squeue: connection timed out
```

cocoa moves that run to `UNREACHABLE`, showing the reason and the last known
status beside it (`UNREACHABLE — last known RUNNING`). Polling continues, and
the next successful poll overwrites it. Nothing needs recovering by hand. (A
scheduler that is down for one run is usually down for all of them — each
run's own poll call reports it for itself.)

A poll that **exits non-zero** is broken code rather than an unreachable
scheduler, but the effect on cocoa is the same — it cannot see the run — so it
is treated the same way: that run goes `UNREACHABLE` with
`poll script failed: <captured output>` as the reason, and the failure is also
raised as a loud operation error so the script gets fixed. Fixing it heals
everything on the next tick.
