#!/usr/bin/env python3
"""Mock check: is the deployed copy of solver.cfg the one in this folder?

Answers all three ways a check can:
  CURRENT   deployed/solver.cfg matches solver.cfg — launch as is
  STALE     it is missing or differs, and nothing is running — deploy first
  CONFLICT  it differs while a run is still active: deploying would swap the
            config out from under that run, so the start is refused
"""
import json
import os

here = os.path.dirname(os.path.abspath(__file__))
TERMINAL = {"SUCCEEDED", "FAILED", "CANCELLED", "ERROR"}


def read(path):
    try:
        with open(path) as fh:
            return fh.read()
    except FileNotFoundError:
        return None


source = read(os.path.join(here, "solver.cfg"))
deployed = read(os.path.join(here, "deployed", "solver.cfg"))
if deployed == source:
    print("COCOA_RETURN: CURRENT")
    raise SystemExit(0)

active = []
runs = os.path.join(here, "runs")
for entry in sorted(os.listdir(runs)) if os.path.isdir(runs) else []:
    try:
        with open(os.path.join(runs, entry, "run.json")) as fh:
            if json.load(fh).get("status") not in TERMINAL:
                active.append(entry)
    except (FileNotFoundError, json.JSONDecodeError):
        continue

if deployed is None:
    print("COCOA_RETURN: STALE mock: nothing deployed yet")
elif active:
    print(f"COCOA_RETURN: CONFLICT mock: solver.cfg changed while run {active[0]} is active")
else:
    print("COCOA_RETURN: STALE mock: solver.cfg changed since the last deploy")
