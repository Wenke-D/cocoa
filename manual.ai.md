# Cocoa Experiment Management Manual

The experiment managment guidence for AI agents. When user use cocoa as expeirment workflow, AI agents should follow this manuel
so that both users and AI agent can have good experimence.

## What is cocoa

Cocoa is end-to-end experiment monitoring GUI application.
It defines typical operations in a experiment and run them and show
their progress. so that user can monitering the progress with graphical UI.

User and AI agent need to implement the code to do that steps
and follow some coco convention to work with cocoa.

Cocoa provide interface for both user and ai agents. User use GUI and ai agent uses a unix socket. The action of the agent can be see in the GUI so that user can clear understand what happensing now.

## Why cocoa
There are already several workflow tool such as snakemake. cocoa is
not meant to replace them, it is for user-end's convience to launch, follow status, progresses and final ready result reports. while snakemake is for defined dependency sequence in the remote run. User even can launch a snakemake job using the launch endpoints in cocoa.

It provide ai-agent interface both for user to keep update what's happening now and also calibearte ai-agent behaviour. to prevent aiagent just do ad-hoc changes to experiment script then user may quickly get lost.

## Opeartion rule for ai-agents.

### Manage experiment through cocoa
Use cocoa to launch, cancel and also check progress experiments. So that both user and ai-agent can stay in the same view of the progress.

Particularlly, do not run launch experiment with sbatch or ssh by hand, create a cocoa experiment first. even for a quick test, we can create a smoke style experiment.

The ai-agent interface is a unix socket at
`~/.local/share/cocoa/cocoa.sock`, socket/help-ai provide detail api description.
The socket exists only while the cocoa window is open. If it is closed, asks user to open it rather than working around it.


for deploy in remote, the check and deploy script should be finish this. check operation check if any updates need to async before launching, and in case of yes, deploy will be called to perform it.
Hence check need have a cache behaviour.

The experiment itself should not contains any content related to building executable or image. but the deploy can make the call to adhoc build script to produce a image then deploy.

### Guidence for writing endpoint scripts

for detail syntax and convention, please see doc/manuel/authering.md

check: 
deploy:
launch:
poll:
cancel:

report: A report answers the experiment's purpose
A report is not the run's log. It answers what the experiment was run for,
and gives what is needed to understand a failure without logging into
remote. What counts as an answer depends on the purpose, and a purpose can
change: an experiment may be reused for something else, and its report
changes with it.

1. **Verdict**, the first line: the answer, and the number it rests on.
2. **What ran**: cocoa run, Slurm job, case path; partition, nodes, ranks;
   dates; the solver, stopAt and endTime; the OpenFOAM build; the image.
3. **Checklist**: each stage of the run (Slurm job, case copy, mesh, fields,
   decomposition, solver, writes, reconstruction), ok or FAIL, with detail.
4. **Diagnosis**, only when something failed: what broke, the end of that
   stage's log, any FOAM FATAL ERROR, error lines from the Slurm output, and
   the Slurm output without Apptainer's INFO noise.
5. **Warnings** from the solver log, each once, with a count.

### Each experiment draws its own

Each experiment folder has its own `report.py` (cocoa's `[report]`
`command = "./report.py"`), which decides the verdict and what to show.
Experiments do not share that logic: one with the same purpose as another
starts as a copy of its `report.py` and is free to diverge. What they do
share lives in `orion/`:

- `orion/cluster.py`: the connection. What Slurm says about a job, and a
  copy of its case in `report/<run>/case/` (logs and `system/` only, or the
  whole case without `processor*`).
- `orion/foamrun.py`: reading what `run_case.sh` left. The stages and the
  one that broke, the checklist, the evidence of a failure, the solver log
  step by step, field statistics. It reads, and never decides what a
  report says.

| Experiments | Their report answers | And carries |
|---|---|---|
| `smoke_edc`, `smoke_fsd` | Is everything wired up: image, MPI across nodes, write, reconstruct? PASS, or FAIL at the stage that broke | The checklist and, on failure, the diagnosis; the logs in `report/<run>/case/` |
| `probe` | What a step costs on N ranks | `Processes:` and `seconds per step:` lines, which `probe_scaling/report.py` reads |
| `full_edc`, `full_fsd`, `legacy_full_edc` | Did the simulation reach endTime, and what did it produce? | Long by design. The history at every written time (Δt, Courant, T, Qdot, continuity, wall time) and min/mean/max of the main fields at each one, then every field at the last. Beside it, `report/<run>/history.csv` (every step) and `report/<run>/case/` (the case without `processor*`, with `case.foam` for ParaView, about 150 MB) |

When an experiment is reused for another purpose, its `report.py` changes
with it, and its row here and a line in the log say so. A campaign report
(like `probe_scaling/report.py`) is one table that answers its question. It
reads its members' reports and never goes back to the cluster.

## 4. Experiment folders

1. A folder with a `cocoa.toml` is one experiment. Its `description` says
   what it is for, and its report purpose matches.
2. The `README.md` table lists every folder; a new experiment adds its row.
3. An experiment folder is self-contained: its `cocoa.toml`, its
   `job.sbatch.tmpl` and its `report.py` (a campaign: its `plan` and
   `report.py`). `orion/` holds only what reaches the cluster and reads its
   runs: launch, poll, cancel, `cluster.py`, `foamrun.py`.
4. `runs/` and `report/` belong to cocoa. We read them and never edit them
   by hand.

## Open items

- [ ] **cocoa: report failed runs.** A FAILED run got no report (cocoa
      `convention.md` §9), so a failed smoke run had no diagnosis. Done on
      coco's branch `report-failed-runs` (report scripts also get
      `COCOA_RUN_STATUS=FAILED|COMPLETED`); to merge and install.
- [ ] **cocoa: re-run a report by hand**, from the window and the agent
      socket. The engine allows it, but nothing reaches it. Being added on
      the same branch.
- [ ] **Move the legacy image build into combustion-in-openfoam**, then
      delete `legacy/` here. Its uncommitted changes are committed first.
      They are formatting (EDC.C) and a clearer inert-specie error
      (reactingFoamDY): no change in behaviour.
- [ ] **Regenerate the existing reports** with each experiment's
      `report.py`, once cocoa can re-run a report (above).
- [ ] **Source commit of the solver image**: `alors cluster deploy` (in
      combustion-solver) writes the commit beside the image, and the job
      prints it with the hash.
- [ ] **Comparison with the legacy solver**: `full_edc` against
      `legacy_full_edc`, field by field at the same times. Both reports now
      carry the same tables, which is a start.

## Log

Gaps in cocoa, decisions, and changes to these rules, newest first.

- 2026-10-06: Each experiment draws its own report (`report.py` in its
  folder); `orion/` keeps the connection (`cluster.py`) and the reading of
  a run (`foamrun.py`). This replaces the shared `orion/report.py --purpose`.
- 2026-10-06: Reports are per purpose (`orion/report.py --purpose`), which
  replaces `orion/report.sh`. Jobs print their image. The legacy build goes
  back to combustion-in-openfoam. `full_edc` did reach endTime (2004 steps,
  26 min); the "about 24 h" in its template was wrong and is fixed.
  cocoa gaps: no report for a FAILED run, and no way to re-run a report
  by hand (only the engine has it); both needed now, see open items.
- 2026-10-06: Rules written. cocoa gap: the agent socket has no cancel
  route (`doc/agent.md` §43.6), so for now Claude asks you to cancel from
  the window.
