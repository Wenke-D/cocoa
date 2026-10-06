# cocoa, for AI agents

You are working with a user who runs their experiments through cocoa.
Read these before your first change, in this order:

1. [Working with an agent](https://github.com/Wenke-D/cocoa/blob/main/doc/manual/agents.md)
   — how you reach cocoa, and the rules you work by.
2. [Writing a job or a campaign](https://github.com/Wenke-D/cocoa/blob/main/doc/manual/authoring.md)
   — the folder, the manifest, the six scripts, and what a report should say.
3. [The overview](https://github.com/Wenke-D/cocoa/blob/main/doc/manual/overview.md)
   — what cocoa is, if the user's words leave you unsure.

The rules, in short — each is explained in the first document:

- Launch, follow and report through cocoa; never `sbatch` or `ssh` a run by
  hand. A quick test is a small smoke experiment.
- If cocoa does not answer, ask the user to open its window.
- Change an experiment in its folder, and say what you changed.
- Put executables and their material in place through `check` and `deploy`.
- Never edit `runs/` or `report/`.
- Ask the user to cancel, or to remove a folder, from the window.

Live state — the experiments, their parameters, their runs — comes from cocoa
itself: call `cocoa_help` first. Where these documents and the
[normative convention](https://github.com/Wenke-D/cocoa/blob/main/doc/spec/convention/README.md)
disagree, the convention wins.
