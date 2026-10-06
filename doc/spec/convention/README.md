# The cocoa convention

The contract between cocoa and an experiment folder.

cocoa does not run experiments. It renders templates, invokes the folder's own
scripts, and maintains that folder's records. Everything cocoa knows about what
an experiment is doing on a cluster, a script told it.

Three rules hold everywhere:

1. **Scripts are invoked as argv, never through a shell.** Values the user
   typed are argv elements, never text spliced into a command line.
2. **No defaults, and no prefill.** Every declared parameter must be supplied
   at start, by hand, every time. cocoa remembers nothing about what you typed
   last time — a value on screen is one a person put there.
3. **cocoa never invents a cluster state.** `PENDING`, `RUNNING`, `COMPLETED`,
   `FAILED`, `CANCELLED` and `UNREACHABLE` come from the poll script and from
   nowhere else. The states cocoa sets itself describe cocoa's *own* pending
   operations, never the experiment's (§9).

## Contents

| | |
|---|---|
| §1 | [Folder layout](01-folder-layout.md) |
| §2 | [`cocoa.toml` — a job](02-job-manifest.md) |
| §3 | [`cocoa.toml` — a campaign](03-campaign-manifest.md) |
| §4 | [Manifest validation](04-manifest-validation.md) |
| §5 | [The private store](05-private-store.md) |
| §6 | [Invocation rules](06-invocation-rules.md) |
| §7 | [Job scripts](07-job-scripts.md) |
| §8 | [Campaign scripts](08-campaign-scripts.md) |
| §9 | [Status](09-status.md) |
| §10 | [When cocoa cannot see a run](10-unreachable-runs.md) |
| §11 | [Reports](11-reports.md) |
| §12 | [What cocoa writes](12-what-cocoa-writes.md) |
