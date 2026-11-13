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
prepare_workdir() {
  local tdir="$1" work="$2"
  mkdir -p "$work"
  (cd "$TALLY" && tar --exclude=./coverage --exclude=./tally.db -cf - .) | (cd "$work" && tar -xf -)
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
