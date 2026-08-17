#!/bin/sh
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "mock: submitting run $run"
echo "COCO_RETURN: slurm-$run"
