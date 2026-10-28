#!/usr/bin/env python3
"""Mock report: both formats, each for its own reading.

report/<run>.txt is the verdict, a line or two that cocoa shows on the run's
page as it is; report/<run>.html is the long read, opened from there. Also
attaches the status history as a CSV.
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

params = {**record.get("render", {}), **record.get("launch", {})}
history = record.get("history", [])
os.makedirs(os.path.join(here, "report"), exist_ok=True)

# The verdict: what a glance at the run needs, and no more.
with open(os.path.join(here, "report", f"{run}.txt"), "w") as out:
    out.write(
        f"PASS  residual 2.1e-07 < tolerance 1e-06 after {len(history)} status changes\n"
        f"      {' '.join(f'{name}={value}' for name, value in params.items())}\n"
    )


def table(head, rows):
    cells = "".join(f"<th>{html.escape(h)}</th>" for h in head)
    body = "".join(
        "<tr>" + "".join(f"<td>{html.escape(str(c))}</td>" for c in row) + "</tr>"
        for row in rows
    )
    return f"<table><thead><tr>{cells}</tr></thead><tbody>{body}</tbody></table>"


# The long read: everything the verdict leaves out.
with open(os.path.join(here, "report", f"{run}.html"), "w") as out:
    out.write(
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>solver-gpu run {run}</title><style>"
        "body{font-family:system-ui,sans-serif;margin:24px;color:#222;line-height:1.5}"
        "table{border-collapse:collapse;margin:8px 0 20px}"
        "th,td{border:1px solid #ddd;padding:4px 10px;text-align:left}"
        "th{background:#f4f1ec}"
        "</style></head><body>"
        f"<h1>solver-gpu, run {run}</h1>"
        f"<p>Submission {html.escape(sub)}. The solver converged: the final "
        "residual, 2.1e-07, is below the 1e-06 tolerance.</p>"
        "<h2>Parameters</h2>"
        + table(["name", "value"], params.items())
        + "<h2>Status history</h2>"
        + table(["status", "at"], [(c["status"], c["at"]) for c in history])
        + "<p>The same history is attached as <code>history.csv</code>.</p>"
        "</body></html>\n"
    )

if attachments is not None:
    with open(os.path.join(here, attachments, "history.csv"), "w") as out:
        out.write("status,at\n")
        for change in history:
            out.write(f"{change['status']},{change['at']}\n")
