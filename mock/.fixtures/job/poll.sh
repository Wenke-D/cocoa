#!/bin/sh
# Answers every submission with whatever `poll-state` says (default RUNNING),
# so a test moves a run by writing one file. A test that needs a *broken*
# poll overwrites this script instead — that failure is its subject.
subs=""
while [ $# -gt 0 ]; do
  case "$1" in
    --submissions) subs="$2"; shift 2 ;;
    *) shift ;;
  esac
done
status="RUNNING"
if [ -f poll-state ]; then
  status=$(cat poll-state)
fi
oldifs=$IFS
IFS=,
for s in $subs; do
  echo "COCO_RETURN: $s $status"
done
IFS=$oldifs
