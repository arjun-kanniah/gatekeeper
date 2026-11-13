#!/usr/bin/env bash
# The pilot: the 3 pilot tasks x setups A, B, C x 1 run = 9 runs, one after another.
# Stops before spending more than PILOT_CAP_USD (default 4) as measured from the runs so far.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

export BATCH="${BATCH:-pilot-$(date +%Y%m%d)}"
cap="${PILOT_CAP_USD:-4}"

"$ROOT/runner/validate-tasks.sh" T01 T02 T03

for task in T01 T02 T03; do
  for setup in A B C; do
    spent=$(node "$ROOT/runner/summarize.mjs" "$ROOT/runs/$BATCH" --total 2>/dev/null || echo 0)
    if node -e "process.exit(Number('$spent') >= Number('$cap') ? 0 : 1)"; then
      echo "stopping: spent \$$spent of the \$$cap pilot cap"; break 2
    fi
    "$ROOT/runner/run-local.sh" "$task" "$setup" 1
  done
done

node "$ROOT/runner/summarize.mjs" "$ROOT/runs/$BATCH"
