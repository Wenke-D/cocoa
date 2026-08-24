---
name: scan
description: Find @ai markers the user wrote in code and implement each requirement in place. Use when the user runs /scan or asks to process @ai comments.
---

# The @ai marker workflow

The user writes requirements directly into the code as comments carrying
`@ai`, at the spot the requirement is about:

    // @ai rename this to snake_case everywhere it appears
    // @ai this branch is dead since the menu was removed — delete it

A marker may carry a **scope** in brackets. Markers sharing a scope name are
one requirement, wherever they sit — read them all before acting on any:

    // @ai[window_state] this state should not surface to this level
    ...
    // @ai[window_state] and here we just ask electron, the old object is useless

An unscoped marker stands alone. Continuation lines directly under a marker
(same comment block) belong to it.

Invoking this skill means: find them all, do them, clean them up.

## Steps

1. **Find every marker.** `git grep -n "@ai"` over the repository (git grep so
   ignored files stay out; also match the old spelling `@agent` if any
   remain). Group by scope, and report how many requirements were found
   before starting.
2. **Understand each in context.** Read enough surrounding code to know what
   the requirement means at that spot. The marker's placement is part of the
   requirement — it points at the code it talks about. For a scoped
   requirement, every marker of the scope is context for the others.
3. **Implement each requirement.** Requirements are independent unless they
   reference each other; handle each completely before moving on. Follow the
   codebase's conventions (snake_case, comment style, doc/ updates where
   behavior changes).
4. **Remove a requirement's markers when it is done.** The change replaces
   the comments. If a requirement is ambiguous, or big enough that the user
   should decide direction first: leave its markers in place, skip it, and
   put the question in the report instead of guessing.
5. **Gate.** Run `npm run gate` in `cocoa-electron/` (or `alors gate` from the
   repository root; `alors gate::all` when a change crossed trees). The exit
   code is the verdict, not the output text. When a change touches behavior a
   drive scenario covers, run that scenario too.
6. **Report per requirement**: where it was, what it asked, what was done —
   or the question that blocked it. Every place the report mentions is a
   clickable markdown link (`[window.ts:96](cocoa-electron/src/main/shell/window.ts#L96)`,
   repo-relative path, `#L` ranges for spans), so the user can jump straight
   back. Link to where the change now sits — the marker is gone and lines
   have shifted, so give the line the edited file actually has, not the line
   the grep reported. A skipped requirement's marker is still in place: link
   to the marker itself.

## Notes

- A marker asking to **explain** something ("explain this function", "why is
  this here?") wants the explanation in the chat report, not written into
  code comments or doc/. Answer it in the report and remove the marker.
- A marker in a comment the user is still drafting (no imperative, just
  notes-to-self, even trailing off mid-sentence) still counts: implement what
  it asks or ask about it.
- Never leave a half-done requirement silently: each one ends this run either
  done-and-removed or reported-with-question.
