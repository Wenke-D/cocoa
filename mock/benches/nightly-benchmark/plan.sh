#!/bin/sh
# Mock plan: three instances, dispatched all at once. The values carry their
# shapes (convention §8.1): a list is a JSON list.
echo 'COCO_RETURN: {"job": "solver-gpu", "params": {"nodes": "64", "gpu": "0"}}'
echo 'COCO_RETURN: {"job": "solver-gpu", "params": {"nodes": "128", "gpu": "1"}}'
echo 'COCO_RETURN: {"job": "flaky-solver", "params": {"nodes": "32", "gpu": "0", "backends": ["cuda"]}}'
