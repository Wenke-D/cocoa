#!/bin/sh
# Counts itself into `deploys`, holds while `deploy-hold` exists, and fails
# when `deploy-state` says `fail`. A deploy that lands leaves the job
# current, as a real one would: the next check answers CURRENT.
echo deployed >> deploys
while [ -f deploy-hold ]; do
  sleep 0.05
done
if [ -f deploy-state ] && [ "$(cat deploy-state)" = "fail" ]; then
  echo "deploy broke" >&2
  exit 1
fi
echo CURRENT > check-state
