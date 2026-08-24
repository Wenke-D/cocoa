#!/bin/sh
# Mock launch: prints the submission id cocoa will track.
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "mock: submitting run $run"
echo "COCOA_RETURN: slurm-$run"
