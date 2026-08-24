#!/usr/bin/env python3
"""Mock bench report: summarizes the members cocoa wrote to members.json."""
import json
import os
import sys

args = sys.argv[1:]
run = args[args.index("--run") + 1]
here = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(here, "runs", run, "members.json")) as fh:
    members = json.load(fh)

os.makedirs(os.path.join(here, "report"), exist_ok=True)
lines = [
    f"Mock bench report for run {run}",
    f"Bench params: {json.dumps(members.get('params', {}))}",
    "",
    "Members:",
]
for member in members["members"]:
    lines.append(
        f"  run {member['run_id']}  {member['job']}  {json.dumps(member['params'])}"
    )

with open(os.path.join(here, "report", f"{run}.txt"), "w") as out:
    out.write("\n".join(lines) + "\n")
