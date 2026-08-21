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


sub = sys.argv[sys.argv.index("--submission") + 1]
here = os.path.dirname(os.path.abspath(__file__))
run_id = sub.rsplit("-", 1)[-1]
try:
    with open(os.path.join(here, "runs", run_id, "run.json")) as fh:
        record = json.load(fh)
except (FileNotFoundError, json.JSONDecodeError):
    print("COCO_RETURN: UNREACHABLE mock: run record unreadable")
    sys.exit(0)
started = parse_time(record["history"][0]["at"]).timestamp()
elapsed = time.time() - started
mode = record.get("launch", {}).get("mode", "")

if record.get("status") == "CANCELLING":
    print("COCO_RETURN: CANCELLED mock: cancel confirmed")
elif mode == "fail" and elapsed >= 8:
    print("COCO_RETURN: FAILED mock: convergence stalled at 8 s")
elif elapsed < 3:
    print("COCO_RETURN: PENDING")
elif elapsed < 15:
    print("COCO_RETURN: RUNNING")
else:
    print("COCO_RETURN: COMPLETED")
