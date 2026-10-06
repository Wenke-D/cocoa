# 4. Manifest validation

A manifest either loads or it does not. A folder whose manifest is broken stays
registered and is **shown with its error** — never hidden, never silently
dropped. Until it loads, cocoa knows its path, the side it registered on (§5)
and the error: not its name, not its parameters.

Rejected at load time:

- `kind` missing or other than `job` / `campaign`;
- `name` missing, not a string, or empty;
- unknown keys for the declared kind, at the top level, in a declared table, or
  on a parameter;
- a `params` entry without a non-empty `name`, a `type` of `string` or
  `enum`, or a non-blank `description` (§2.2); an enum without `values`, or
  with an empty list, an empty value or a repeated one; `values` on anything
  but an enum; `list` that is not a boolean; a `params` that is the old list
  of bare names;
- a name declared twice in one list, or in both `[render].params` and
  `[launch].params` (§2.1);
- a missing required table or `command`;
- a `command` string that does not word-split (unclosed quote, bad escape);
- a `[render].template` that is not a file in the folder;
- a template whose variables do not exactly match `[render].params` (§6.1);
- a template that pulls in another file with `{% include %}`, `{% extends %}`
  or `{% import %}` (§6.1).

Manifests are re-read on every listing: the store holds the folder path and
its kind, never a parsed copy. Editing `cocoa.toml` therefore takes effect without
re-registering, and fixing a broken manifest heals the entity in place, history
intact. Listing happens on the refresh tick, not on every frame.
