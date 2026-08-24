#!/bin/sh
# Writes the bench report over the members file coco hands it.
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p report
echo "bench report $run" > "report/$run.txt"
