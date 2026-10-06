#!/bin/sh
# Mock deploy: puts solver.cfg where the runs read it, taking a moment so the
# run is seen DEPLOYING first.
echo "mock: deploying solver.cfg"
sleep 2
mkdir -p deployed
cp solver.cfg deployed/solver.cfg
