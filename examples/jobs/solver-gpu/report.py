#!/usr/bin/env python3
"""Mock report: writes report/<run>.txt and an HTML variant.

solver-gpu also attaches its status history as a CSV.
"""
import html
import json
import os
import sys

args = sys.argv[1:]
run = args[args.index("--run") + 1]
sub = args[args.index("--submission") + 1]
attachments = (
    args[args.index("--attachment-dir") + 1] if "--attachment-dir" in args else None
)
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

# solver-gpu also demonstrates the HTML report path.
if os.path.basename(here) == "solver-gpu":
    body = "<br>".join(html.escape(line) for line in lines)
    with open(os.path.join(here, "report", f"{run}.html"), "w") as out:
        out.write(
            "<!doctype html><html><head><meta charset='utf-8'>"
            f"<title>Mock report {run}</title></head>"
            f"<body style='font-family: monospace'>{body}</body></html>\n"
        )

    if attachments is not None:
        with open(os.path.join(here, attachments, "history.csv"), "w") as out:
            out.write("status,at\n")
            for change in record.get("history", []):
                out.write(f"{change['status']},{change['at']}\n")
