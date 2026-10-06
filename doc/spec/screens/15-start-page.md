# 15. Start Page

Starting must happen on a page of its own, reached from the experiment and
addressed as `experiment > Start` in the breadcrumbs (§9.2).

Do not permanently display the parameter field on the overview page.

A start is a piece of work, not a dialog: it has parameters to fill, a check to
read, and a failure worth laying out. Earlier drafts of this specification put
it in a centered modal on the principle that a modal is a temporary action and
never a place (§9). The principle stands and the classification was wrong —
this one is a place, the trail says where it sits, and the failure it can
produce is a list rather than a sentence (§15.4).

Cancel confirmation stays a modal (§16): that one really is a temporary
question, answered and gone.

## 15.1 Contents

The Start page contains:

- The experiment's name as the title, under a small `START JOB` / `START CAMPAIGN`
  type label — the identity block an entity page uses (§13.1). The title takes
  the ordinary heading colour: the accent means "interactive" everywhere else in
  the workbench, so an accented title would read as a link.
- For a Campaign, a note that the runs to dispatch are decided at start.
- A `PARAMETERS` section, marked `(all required)`, holding one field per
  declared parameter, in declaration order, each under its name, what may be
  put there (the `Values` wording of §13.1), and its description (convention
  §2.2).
- The last-used shortcut as the section's one icon action, at the right of the
  `PARAMETERS` row — the shape the sidebar's title row already uses.
- Active-run notice when applicable, informational only and never blocking.
- Inline validation error.
- Back button, returning to the experiment's overview.
- Primary Start button.

The form keeps a measure of its own rather than filling the editor's width: a
declared parameter is a short value, and a field the width of the window invites
a paragraph.

For a Campaign, the page cannot preview the plan — the plan does not exist until
Start is pressed. Do not display a fabricated job list.

Example:

```text
START JOB
solver-gpu

PARAMETERS  (all required)                          [history]

  nodes  a string
  Nodes to request
  [ required                                               ]

  gpu  0 / 1
  Which GPU to pin to
  [ Choose…                                              v ]

  profile  true / false
  Run under the profiler
  [ Choose…                                              v ]

  backends  [cuda, hip]
  Backends to try, in order
  [ ] cuda   [ ] hip

Cancel                                            Start Job
```

Every field opens empty and stays that way until a person touches it (§15.3).
Start stays disabled until each one has a value.

The field is the shape (convention §2.2):

| Shape            | Field                                                              |
|------------------|--------------------------------------------------------------------|
| `string`         | a text field                                                       |
| `enum`           | a choice, opening on `Choose…` with nothing picked                 |
| `string` list    | a text box, one value per line; blank lines are not values         |
| `enum` list      | one checkbox per value, none ticked to begin with                  |

A yes/no parameter is an enum of two values (convention §2.2) and gets the
enum's choice like any other — never a lone checkbox for the whole value: a
checkbox that is not ticked says `false` whether or not anyone looked at it,
and §15.3 needs "not considered" to be visible. The ticks of an enum *list*
are different: none ticked is an empty list, which is no value, and Start
stays disabled for it.

What the user has typed is a draft held outside the route: a route is a place,
and a half-filled form is not one. Leaving the page discards the draft, and so
does a start that succeeds — coming back to Start opens the empty form §15.3
asks for. (Routes are not restored at all: a launch opens on the Explorer
with nothing selected, per architecture §32.)

## 15.2 Parameter Semantics

A parameter value is a string with a declared shape (convention §2.2): one
string, one of a set, or one or more of either. The form checks nothing
beyond the shape, and the engine checks the same thing again on every way in.

The application must not:

- Parse shell syntax.
- Split arguments.
- Execute the string.
- Validate command-line semantics.

Every parameter the manifest declares is required (convention §2.1). A value
that is empty or only whitespace counts as not supplied: Start is disabled, and
the disabled Start names what is still missing on hover. The requirement is
stated once, as `(all required)` beside the section title, rather than as a
running tally of empty fields beneath them; each empty field says `required` in
its own placeholder. An experiment that declares no parameters starts with
none.

The engine refuses a blank value exactly as it refuses a missing one, so a start
reaching it by any other route — a Campaign dispatching a member, say — is refused
the same way.

## 15.3 No Prefill by Default

The page opens with every field empty. It does not prefill from the last run,
from the manifest, or from anything else on its own — every declared parameter
is supplied by hand, deliberately, each time (convention §2).

A prefilled field is indistinguishable from one the user filled, and a start is
a job on a cluster. Restarting *last night's* sweep because the form remembered
it is a mistake this application must not be able to make for you.

The one way in with values is the history's row menu (§22.6): *Start with
these parameters…* opens this page with one particular run's values filled in.
That is an explicit act on a run the user is looking at, never a memory of
what was typed last, and the page says what it filled — and what it could not.

> There used to be a **Fill from last run** action here, and a `last_args` map
> in the store behind it: an explicit button, never a default, that filled the
> fields and stopped there. Both are gone as of 2026-08-20. It was the one
> thing cocoa remembered about what a person had typed. The row menu is what
> replaced it: the values come from a run's record, not from a memory of the
> form.

## 15.4 Submission

On submission:

1. Disable the Start button.
2. Show `Starting…`.
3. Call the Start operation (§26).
4. On success:
   - Close the modal.
   - Create a new run.
   - Navigate immediately to its run-detail page.
5. On failure:
   - Keep the modal open.
   - Re-enable submission.
   - Show an inline error.

For a Campaign, step 3 produces the plan, validates it against the Explorer (§2.3.2),
and dispatches every call. Plan validation failure is a Start failure: the modal
stays open, nothing is dispatched, and the error names **every** call that
cannot be dispatched, not the first one found.

A plan is generated by a script, so its mistakes arrive in batches: one wrong
parameter name is usually that same name in twenty calls. Reporting the first
one makes the user fix it, start again, and meet the second — so all of them are
checked and listed together, with a count that separates one typo from a plan
that is wrong throughout.

Example inline error:

```text
Cannot start this Campaign. 3 of its 12 calls cannot be dispatched:

  call 2: `solver-xl` is not a registered job
  call 5: job `solver-gpu` — missing `gpu`, extra `device`
  call 9: `solver-xl` is not a registered job

No runs were dispatched.
```

## 15.5 Keyboard

Use the platform command modifier:

```text
macOS: Command + Enter
Linux: Control + Enter
```

to submit.

`Escape` does nothing here. A page is left, not dismissed: the Back button and
the breadcrumb above it both say where to.

Do not use plain Enter when focus behavior could cause accidental launches.
