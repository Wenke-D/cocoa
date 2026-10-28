#!/usr/bin/env python3
"""Mock report: HTML only, the long read with no verdict to give at a glance.

cocoa shows no text on the run's page, only the button that opens this.
"""
import html
import json
import os
import sys

args = sys.argv[1:]
run = args[args.index("--run") + 1]
sub = args[args.index("--submission") + 1]
here = os.path.dirname(os.path.abspath(__file__))

with open(os.path.join(here, "runs", run, "run.json")) as fh:
    record = json.load(fh)

params = {**record.get("render", {}), **record.get("launch", {})}
rows = "".join(
    f"<tr><td>{html.escape(change['status'])}</td><td>{html.escape(change['at'])}</td></tr>"
    for change in record.get("history", [])
)

os.makedirs(os.path.join(here, "report"), exist_ok=True)
with open(os.path.join(here, "report", f"{run}.html"), "w") as out:
    out.write(
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>flaky-solver run {run}</title><style>"
        "body{font-family:system-ui,sans-serif;margin:24px;color:#222;line-height:1.5}"
        "table{border-collapse:collapse}"
        "th,td{border:1px solid #ddd;padding:4px 10px;text-align:left}"
        "th{background:#f4f1ec}"
        "</style></head><body>"
        f"<h1>flaky-solver, run {run}</h1>"
        f"<p>Submission {html.escape(sub)}, with "
        f"<code>{html.escape(json.dumps(params))}</code>. Between 5 and 10 seconds "
        "the scheduler could not be reached; the run carried on regardless and "
        "finished on its own.</p>"
        "<h2>Status history</h2>"
        f"<table><thead><tr><th>status</th><th>at</th></tr></thead><tbody>{rows}</tbody></table>"
        "</body></html>\n"
    )
