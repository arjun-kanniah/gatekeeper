#!/usr/bin/env bash
# The full run: every task x setups A, B, C x RUNS runs (default 2), one after another.
# Stops before spending more than FULL_CAP_USD (default 8) as measured from the runs so far.
# Re-running with the same BATCH resumes: finished runs are skipped.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

export BATCH="${BATCH:-full-$(date +%Y%m%d)}"
cap="${FULL_CAP_USD:-8}"
runs="${RUNS:-2}"

"$ROOT/runner/validate-tasks.sh"

tasks=()
for d in "$ROOT"/tasks/T*/; do tasks+=("$(basename "$d" | cut -d- -f1)"); done

# Run number outermost, so a stop part-way still leaves one complete pass over everything.
for run in $(seq 1 "$runs"); do
  for task in "${tasks[@]}"; do
    for setup in A B C; do
      spent=$(node "$ROOT/runner/summarize.mjs" "$ROOT/runs/$BATCH" --total 2>/dev/null || echo 0)
      if node -e "process.exit(Number('$spent') >= Number('$cap') ? 0 : 1)"; then
        echo "stopping: spent \$$spent of the \$$cap cap"; break 3
      fi
      "$ROOT/runner/run-local.sh" "$task" "$setup" "$run" || echo "run failed: $task $setup $run"
    done
  done
done

node "$ROOT/runner/summarize.mjs" "$ROOT/runs/$BATCH"
