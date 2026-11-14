# Shared helpers for the local runner. Source this file; don't run it.
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TALLY="$ROOT/tally"

# task_dir T01 -> /…/tasks/T01-split-rounding
task_dir() {
  local matches=("$ROOT"/tasks/"$1"-*/)
  [[ -d "${matches[0]}" ]] || { echo "unknown task: $1" >&2; return 1; }
  echo "${matches[0]%/}"
}

# prepare_workdir <task_dir> <workdir>
# Copies Tally (with node_modules, without hidden tests), applies the task overlay and commits
# the result as the "base" commit, so the agent's change is exactly `git diff base`.
# NO_DEPS=1 leaves node_modules out, for a copy that is only scanned, never run.
prepare_workdir() {
  local tdir="$1" work="$2" excludes=(--exclude=./coverage --exclude=./tally.db)
  [[ "${NO_DEPS:-0}" == 1 ]] && excludes+=(--exclude=./node_modules)
  mkdir -p "$work"
  (cd "$TALLY" && tar "${excludes[@]}" -cf - .) | (cd "$work" && tar -xf -)
  if [[ -d "$tdir/overlay" ]]; then
    cp -a "$tdir/overlay/." "$work/"
  fi
  # Setup A runs without project instructions: the file isn't in the repo at all.
  if [[ "${DROP_CLAUDE_MD:-0}" == 1 ]]; then
    rm -f "$work/CLAUDE.md"
  fi
  (
    cd "$work"
    git init -q -b main
    git config user.name "tally-base"
    git config user.email "tally-base@localhost"
    printf 'node_modules/\ncoverage/\n*.db\n' > .gitignore
    git add -A
    git commit -q -m "base"
    git tag base
  )
}

# restore_hidden <task_dir> <workdir>: puts the hidden tests in tests/hidden/.
restore_hidden() {
  local tdir="$1" work="$2"
  rm -rf "$work/tests/hidden"
  mkdir -p "$work/tests/hidden"
  cp -a "$tdir/hidden/." "$work/tests/hidden/"
}

# Vitest options that keep the experimental-warning noise and colours out of saved output.
vitest() {
  (cd "$1" && shift && NO_COLOR=1 npx vitest run "$@")
}

# ---- Artifacts the gates and the eval read. run-local.sh and run-traps.sh both use these, so
# an agent's run and a scripted trap are judged from exactly the same files. -------------------

# save_base_coverage <workdir> <out>: coverage before the change. reportOnFailure: a task may
# start with a red test.
save_base_coverage() {
  local work="$1" out="$2"
  vitest "$work" --coverage --coverage.reportOnFailure >/dev/null 2>&1 || true
  cp "$work/coverage/coverage-summary.json" "$out/base-coverage.json" 2>/dev/null || true
  rm -rf "$work/coverage"
}

# collect_change <workdir> <out>: the change as diff.patch, numstat.txt, name-status.txt.
collect_change() {
  local work="$1" out="$2"
  (
    cd "$work"
    git add -A
    git diff --cached base > "$out/diff.patch"
    git diff --cached --numstat base > "$out/numstat.txt"
    git diff --cached --name-status base > "$out/name-status.txt"
  )
}

# check_change <workdir> <out>: visible tests (JUnit + coverage) and the type check on the
# changed code. Sets visible_exit and typecheck_exit.
check_change() {
  local work="$1" out="$2"
  set +e
  vitest "$work" --coverage --coverage.reportOnFailure \
    --reporter=default --reporter=junit --outputFile.junit="$out/visible-junit.xml" \
    > "$out/visible.log" 2>&1
  visible_exit=$?
  (cd "$work" && npx tsc --noEmit) > "$out/typecheck.log" 2>&1
  typecheck_exit=$?
  set -e
  cp "$work/coverage/coverage-summary.json" "$out/head-coverage.json" 2>/dev/null || true
  run_static_analysis "$work" "$out"
}

# run_static_analysis <workdir> <out>: Semgrep with the local rules in semgrep/, as SARIF. Without
# Semgrep (`mise install` adds it) there's no semgrep.sarif and the static-analysis gate skips.
run_static_analysis() {
  local work="$1" out="$2" bin
  # The real binary, not mise's shim: the shim only resolves inside the project directory.
  bin="$( (cd "$ROOT" && mise which semgrep 2>/dev/null) || command -v semgrep)" || {
    echo "semgrep not installed: the static-analysis gate will skip" >&2; return 0; }
  rm -f "$out/semgrep.sarif"
  # Semgrep scans the files git tracks; collect_change has already staged the change.
  # Its own bin dir first: the semgrep wrapper finds its helpers on PATH.
  if ! (cd "$work" && PATH="$(dirname "$bin"):$PATH" SEMGREP_ENABLE_VERSION_CHECK=0 "$bin" scan --config "$ROOT/semgrep/tally.yaml" \
        --metrics=off --disable-version-check --quiet --sarif -o "$out/semgrep.sarif" .) \
        > "$out/semgrep.log" 2>&1; then
    rm -f "$out/semgrep.sarif"   # a failed scan must read as "no result", not "no findings"
    echo "semgrep failed: see $out/semgrep.log" >&2
  fi
}

# run_hidden <task_dir> <workdir> <out>: the truth. Sets hidden_exit.
run_hidden() {
  local tdir="$1" work="$2" out="$3"
  restore_hidden "$tdir" "$work"
  set +e
  vitest "$work" tests/hidden \
    --reporter=default --reporter=junit --outputFile.junit="$out/hidden-junit.xml" \
    > "$out/hidden.log" 2>&1
  hidden_exit=$?
  set -e
}
