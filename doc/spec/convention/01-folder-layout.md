# 1. Folder layout

An experiment folder is a directory containing a manifest, the scripts and
template it declares, and — once cocoa has been used on it — its own records.

```
<entity folder>/
  cocoa.toml              # the manifest: the interface to cocoa
  job.sbatch.tmpl        # the template; the middle name is yours to choose
  check.sh  deploy.sh  launch.sh  poll.py  report.py  cancel.sh
  runs/                  # maintained by cocoa: this folder's history
    <run_id>/
      run.json           # record: args, submission id, status history
      job.sbatch         # the rendered template (jobs)
      members.json       # the fan-out (campaigns)
  report/                # report output, at the folder root
    <run_id>.txt         # required
    <run_id>.html        # optional
```

A folder carries its full history and results with it: copy the folder and the
runs come along. cocoa touches nothing else inside it (§12).

Registration is by path. A folder does not need to be registered for its
records to make sense — `runs/` is readable on its own.

**cocoa does not guess an interpreter.** Either a script is executable and
carries a shebang (`./poll.py`), or the manifest names the interpreter itself
(`command = "python3 poll.py"`). There is no extension-to-executor table, and
no shell is involved in either case.
