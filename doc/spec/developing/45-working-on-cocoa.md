# 45. Working on cocoa

This document describes a workbench that exists. Read it as the standing
description of what cocoa is and why, not as a build order — §40 carries what is
outstanding.

Two things are worth knowing before changing anything.

**The folder is the record.** cocoa keeps no database. An experiment folder holds
its own manifest, its own runs, and its own reports ([convention §1](../convention/01-folder-layout.md)), and
both implementations write them identically. A change that makes a folder less
portable between them is a regression even when every test passes.

**The boundaries in §41 are the design.** The domain in the main process, the
renderer as a client, the backend as the only judge of change, guarded writes
on the engine, the page's vocabulary fixed at the preload — each of these
was arrived at for a reason recorded somewhere in this specification, and the
security argument in §5.1 rests on the last of them.

Where a detail is not specified, choose the simplest implementation that
preserves the product principles here, and record the decision — in the README
if a user would meet it, in [decided.md](decided.md) if a future change would
otherwise re-argue it.
