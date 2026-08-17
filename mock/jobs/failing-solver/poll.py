#!/usr/bin/env python3
"""Mock poll: fails at 8 s when launch mode=fail, otherwise healthy."""
import json
import os
import re
import sys
import time
from datetime import datetime


def parse_time(text):
    """chrono writes nanosecond precision; normalize to microseconds."""
    match = re.match(
        r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?([+-]\d{2}:\d{2}|Z)?$",
        text,
    )
    if not match:
        raise ValueError(f"unparseable timestamp: {text}")
    base, frac, zone = match.groups()
    if frac:
        base += "." + (frac[1:] + "000000")[:6]
    if zone and zone != "Z":
        base += zone
    return datetime.fromisoformat(base)


subs = sys.argv[sys.argv.index("--submissions") + 1].split(",")
here = os.path.dirname(os.path.abspath(__file__))
now = time.time()

for sub in subs:
    run_id = sub.rsplit("-", 1)[-1]
    try:
        with open(os.path.join(here, "runs", run_id, "run.json")) as fh:
            record = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        continue
    started = parse_time(record["history"][0]["at"]).timestamp()
    elapsed = now - started
    mode = record.get("launch", {}).get("mode", "")

    if record.get("status") == "CANCELLING":
        print(f"COCO_RETURN: {sub} CANCELLED mock: cancel confirmed")
    elif mode == "fail" and elapsed >= 8:
        print(f"COCO_RETURN: {sub} FAILED mock: convergence stalled at 8 s")
    elif elapsed < 3:
        print(f"COCO_RETURN: {sub} PENDING")
    elif elapsed < 15:
        print(f"COCO_RETURN: {sub} RUNNING")
    else:
        print(f"COCO_RETURN: {sub} COMPLETED")
