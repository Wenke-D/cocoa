#!/usr/bin/env python3
"""Mock report: writes report/<run>.txt."""
import json
import os
import sys

args = sys.argv[1:]
run = args[args.index("--run") + 1]
sub = args[args.index("--submission") + 1]
here = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(here, "runs", run, "run.json")) as fh:
    record = json.load(fh)

os.makedirs(os.path.join(here, "report"), exist_ok=True)
lines = [
    f"Mock report for run {run} (submission {sub})",
    "",
    "Render params: " + json.dumps(record.get("render", {})),
    "Launch params: " + json.dumps(record.get("launch", {})),
    "",
    "Status history:",
]
for change in record.get("history", []):
    lines.append(f"  {change['status']}  {change['at']}")

with open(os.path.join(here, "report", f"{run}.txt"), "w") as out:
    out.write("\n".join(lines) + "\n")
