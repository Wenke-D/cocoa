#!/bin/sh
# Answers with whatever `check-state` says (default CURRENT): a word, and an
# optional reason after it.
answer="CURRENT"
if [ -f check-state ]; then
  answer=$(cat check-state)
fi
echo "COCOA_RETURN: $answer"
