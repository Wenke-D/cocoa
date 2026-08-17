#!/bin/sh
# Mock launch: prints the submission id coco will track.
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "mock: submitting run $run"
echo "COCO_RETURN: slurm-$run"
