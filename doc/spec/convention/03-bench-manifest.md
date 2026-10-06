# 3. `cocoa.toml` — a bench

A **bench** is a fan-out launcher. Its plan turns the bench's parameters into
instances of jobs **already registered in cocoa**. A bench never defines,
contains, or owns jobs.

```toml
kind        = "bench"
name        = "nightly-benchmark"
description = "Mesh sweep across the GPU solver"

[plan]
command     = "./plan.sh"           # gets the bench's params

[[plan.params]]                     # ALL required at start; shaped as §2.2
name        = "mesh"
type        = "enum"
values      = ["coarse", "fine"]
description = "Which mesh family to sweep"

[report]
command     = "./report.py"         # gets --run and --members
```

A bench has no template, no launch, no poll and no cancel of its own:

- it **launches** through its member jobs' own `launch`;
- its **status** is derived from its members, never polled (§9.1);
- it is **cancelled** by cancelling its still-active members, each through that
  member job's own `cancel`.
