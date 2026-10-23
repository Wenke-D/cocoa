#!/usr/bin/env python3
"""Mock viewer: opens the run's HTML report in the browser.

Stands in for a real viewer — a plotting window, ParaView on the output
tree — that cocoa starts by hand on a reported run and lets go.
"""
import os
import sys
import webbrowser

args = sys.argv[1:]
run = args[args.index("--run") + 1]
report_dir = args[args.index("--report-dir") + 1]

page = os.path.abspath(os.path.join(report_dir, f"{run}.html"))
if not os.path.isfile(page):
    sys.exit(f"run {run} has no HTML report to open")
if not webbrowser.open("file://" + page):
    sys.exit(f"no browser to open {page}")
