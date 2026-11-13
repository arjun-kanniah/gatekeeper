#!/usr/bin/env bash
# Checks every task (or the ones named) before any agent runs on it:
#   1. on the base code, the visible tests behave as the task intends
#      (pass, except a task with a deliberately failing visible test);
#   2. on the base code, the hidden tests FAIL (otherwise the task measures nothing);
#   3. with the reference solution applied, visible AND hidden tests PASS
#      (otherwise the hidden tests are wrong).
# No API calls, no cost.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

tasks=("$@")
if [[ ${#tasks[@]} -eq 0 ]]; then
  for d in "$ROOT"/tasks/T*/; do tasks+=("$(basename "$d" | cut -d- -f1)"); done
fi

scratch="$(mktemp -d "${TMPDIR:-/tmp}/gk-validate-XXXXXX")"
trap 'rm -rf "${scratch:?}"' EXIT
failed=0

for t in "${tasks[@]}"; do
  tdir="$(task_dir "$t")"
  work="$scratch/$t"
  prepare_workdir "$tdir" "$work"
  expect_visible_fail=$(grep -q '^kind: failing-test-temptation' "$tdir/task.yaml" && echo 1 || echo 0)

  if vitest "$work" >/dev/null 2>&1; then visible_base=pass; else visible_base=fail; fi
  restore_hidden "$tdir" "$work"
  if vitest "$work" tests/hidden >/dev/null 2>&1; then hidden_base=pass; else hidden_base=fail; fi
  rm -rf "$work/tests/hidden"

  (cd "$work" && git apply --whitespace=nowarn "$tdir/solution.patch")
  if vitest "$work" >/dev/null 2>&1; then visible_fix=pass; else visible_fix=fail; fi
  restore_hidden "$tdir" "$work"
  if vitest "$work" tests/hidden >/dev/null 2>&1; then hidden_fix=pass; else hidden_fix=fail; fi
  if (cd "$work" && npx tsc --noEmit >/dev/null 2>&1); then types_fix=pass; else types_fix=fail; fi

  want_visible_base=$([[ $expect_visible_fail == 1 ]] && echo fail || echo pass)
  ok=1
  [[ $visible_base == "$want_visible_base" ]] || ok=0
  [[ $hidden_base == fail ]] || ok=0
  [[ $visible_fix == pass && $hidden_fix == pass && $types_fix == pass ]] || ok=0
  status=$([[ $ok == 1 ]] && echo OK || echo PROBLEM)
  [[ $ok == 1 ]] || failed=1
  printf '%-4s %-8s base: visible=%s (want %s) hidden=%s (want fail) | fixed: visible=%s hidden=%s types=%s\n' \
    "$t" "$status" "$visible_base" "$want_visible_base" "$hidden_base" "$visible_fix" "$hidden_fix" "$types_fix"
done

exit $failed
