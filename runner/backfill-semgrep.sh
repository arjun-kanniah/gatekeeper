#!/usr/bin/env bash
# Adds semgrep.sarif to runs collected before Semgrep was part of the pipeline. It rebuilds each
# run's code from the base plus its diff.patch; nothing is re-run, no API calls. Usage:
#
#   runner/backfill-semgrep.sh runs/<batch>      (FORCE=1 to redo runs that already have one)
set -euo pipefail
source "$(dirname "$0")/lib.sh"

batch="${1:?usage: backfill-semgrep.sh runs/<batch>}"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/gk-backfill-XXXXXX")"
trap 'rm -rf "${scratch:?}"' EXIT

n=0
while IFS= read -r meta; do
  out="$(cd "$(dirname "$meta")" && pwd)"
  [[ -e "$out/semgrep.sarif" && "${FORCE:-0}" != 1 ]] && continue
  task="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).task' "$meta")"
  setup="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).setup' "$meta")"
  work="$scratch/w$n"
  DROP_CLAUDE_MD=$([[ $setup == A ]] && echo 1 || echo 0) NO_DEPS=1 \
    prepare_workdir "$(task_dir "$task")" "$work" >/dev/null
  if [[ -s "$out/diff.patch" ]]; then
    (cd "$work" && git apply --whitespace=nowarn "$out/diff.patch" && git add -A)
  fi
  run_static_analysis "$work" "$out"
  rm -rf "${work:?}"
  n=$((n + 1))
done < <(find "$batch" -name meta.json | sort)
echo "scanned $n runs in $batch"
