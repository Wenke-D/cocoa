#!/bin/sh
# Mock plan: three instances, dispatched all at once.
echo 'COCO_RETURN: {"job": "solver-gpu", "params": {"nodes": "64", "gpu": "0"}}'
echo 'COCO_RETURN: {"job": "solver-gpu", "params": {"nodes": "128", "gpu": "1"}}'
echo 'COCO_RETURN: {"job": "flaky-solver", "params": {"nodes": "32", "gpu": "0"}}'
