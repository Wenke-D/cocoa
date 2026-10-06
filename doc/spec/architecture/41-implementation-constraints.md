# 41. Implementation Constraints

1. Keep the domain in the main process. Do not move engine logic into the
   renderer, and do not add a second copy of it there.
2. Do not let `src/main/engine/` import from Electron (§33).
3. Do not let the renderer import from `src/main/` (§33).
4. Do not widen the preload bridge to a general channel. Every capability the
   page has is a named member of that object, and that is the security property
   §5.1 turns on.
5. Do not let the renderer mutate `app.world` to reflect an action it took.
   Events update the screen (§34).
6. Do not make the renderer judge change or compute a diff (§26.3).
7. Do not write engine state after an `await` without a guard (§26.2).
8. Do not put report text in the world (§10.5).
9. Do not run a shell from the UI. Commands are split lexically from the
   manifest and spawned without a shell (`invoke.ts`).
10. Do not trust a report's content. It renders in a sandboxed frame without
    `allow-same-origin` (§20).
11. Do not trust `ui-state.json`. Everything loaded goes through `sanitize`
    (§32).
12. Do not create a permanent right-side inspector.
13. Do not put the parameter field permanently on overview pages.
14. Do not display full run details only in a sidebar.
15. Do not conflate query failure with experiment failure, or cocoa's `Error`
    with the experiment's `Failed` (§10.2).
16. Do not model a Campaign as owning, defining, or sequencing Jobs.
17. Do not duplicate a run record to serve both the Job and Campaign views.
18. Do not reintroduce a concurrency policy or block Start on active runs.
19. Do not make the Query operation a prominent manual action.
20. Do not remove active runs from the UI when navigating elsewhere.
21. Do not silently discard user-entered parameters after a failed Start.
22. Do not let dependency versions float; do not upgrade without recording the
    reason.
23. Keep the on-disk convention as `convention.md` states it. A folder an
    earlier cocoa wrote must still load; the test suites are what catch it.
