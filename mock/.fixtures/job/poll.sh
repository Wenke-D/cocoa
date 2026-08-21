#!/bin/sh
# Answers the polled submission with whatever `poll-state` says (default
# RUNNING), so a test moves a run by writing one file. A test that needs a
# *broken* poll overwrites this script instead — that failure is its subject.
status="RUNNING"
if [ -f poll-state ]; then
  status=$(cat poll-state)
fi
echo "COCO_RETURN: $status"
