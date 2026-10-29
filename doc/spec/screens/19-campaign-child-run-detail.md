# 19. Campaign Child-Run Detail Page

A run dispatched by a Campaign gets a complete detail page, reached from the Campaign
run's dispatch table.

This page and `JobRunDetail` render **the same run record** (§2.3.1). They must
present identical facts. The only differences are breadcrumbs, the Explorer
selection, and the link back to the Campaign run.

The page must show:

- Breadcrumbs back to the Campaign run.
- The Job's name, linking to that Job's own overview.
- Call index within the plan.
- Execution status.
- Start time.
- End time when applicable.
- Duration.
- The parameters the Campaign derived for this call.
- Query health.
- Report state.
- Cancel action while the run is active.

Cancelling here cancels this one run. It does not cancel the Campaign run and does
not touch sibling runs.

A call run again (convention §8.5) has had more than one run. Its page lists
them all in an `Attempts` fact, oldest first, each run id a link to its own
page here and the one shown in bold, so the failed run and the one that
replaced it are a click apart. An earlier attempt keeps its page: it is still
the campaign's, only no longer the call's current run.

The sidebar must continue highlighting the parent Campaign.

Example breadcrumb:

```text
Nightly Benchmark
/ Run 2026-08-15 10:24
/ Solver GPU --mesh=256
```

When a plan dispatches the same Job several times, the breadcrumb leaf must
disambiguate — by parameters, by call index, or both. `Solver GPU` alone is
ambiguous and unacceptable.

The Job named here **is** the Explorer's Solver GPU entry — that is the corrected
model. But arriving through the Campaign must not move the Explorer selection to it.
Offer navigation to the Job explicitly instead: clicking the Job name opens that
Job's overview and, at that point, selects it in the Explorer.
