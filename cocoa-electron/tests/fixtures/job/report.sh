#!/bin/sh
# Writes the run's report, unless `report-state` says `fail`.
run=""
while [ $# -gt 0 ]; do
  case "$1" in
    --run) run="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ -f report-state ] && [ "$(cat report-state)" = "fail" ]; then
  echo "report script exploded" >&2
  exit 1
fi
mkdir -p report
echo "report for run $run" > "report/$run.txt"
echo "COCOA_RETURN: nothing"
