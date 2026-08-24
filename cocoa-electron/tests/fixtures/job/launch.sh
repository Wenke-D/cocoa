#!/bin/sh
# Submits: the run id becomes the submission id, so a test can predict it.
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "submitting run $run"
echo "COCOA_RETURN: sub-$run"
