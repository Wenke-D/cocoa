#!/bin/sh
# One planned call per line of `plan-lines`, echoed under the contract prefix.
# A test writes the plan it wants — including a deliberately bad one — without
# touching this script.
[ -f plan-lines ] || exit 0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  echo "COCOA_RETURN: $line"
done < plan-lines
