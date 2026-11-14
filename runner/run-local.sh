#!/usr/bin/env bash
# Runs Claude Code headless on one task with one setup, then collects everything the gates
# and the eval need. Usage:
#
#   runner/run-local.sh <task> <setup> [run-number]     e.g. runner/run-local.sh T01 A 1
#
# Setups:
#   A  Haiku,  no CLAUDE.md
#   B  Haiku,  with CLAUDE.md
#   C  Sonnet, with CLAUDE.md
#
# Needs ANTHROPIC_API_KEY for the dedicated Gatekeeper key (put it in ../.env, which is
# git-ignored). The run uses --bare, so Claude Code authenticates ONLY with that key (never a
# claude.ai login) and loads none of your personal settings, memory, hooks or CLAUDE.md.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

task="${1:?usage: run-local.sh <task> <A|B|C> [run]}"
setup="${2:?usage: run-local.sh <task> <A|B|C> [run]}"
run="${3:-1}"
tdir="$(task_dir "$task")"

if [[ -f "$ROOT/.env" ]]; then set -a; source "$ROOT/.env"; set +a; fi
: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY (the Gatekeeper key) in $ROOT/.env}"

case "$setup" in
  A) model="claude-haiku-5-5";  with_claude_md=0; budget="${BUDGET_HAIKU:-0.30}" ;;
  B) model="claude-haiku-5-5";  with_claude_md=1; budget="${BUDGET_HAIKU:-0.30}" ;;
  C) model="claude-sonnet-5-5"; with_claude_md=1; budget="${BUDGET_SONNET:-1.50}" ;;
  *) echo "setup must be A, B or C" >&2; exit 2 ;;
esac

batch="${BATCH:-local-$(date +%Y%m%d)}"
out="$ROOT/runs/$batch/$task/$setup-r$run"
if [[ -e "$out/meta.json" && "${FORCE:-0}" != 1 ]]; then
  echo "skip: $out already has results (FORCE=1 to redo)"; exit 0
fi
mkdir -p "$out"

work="$(mktemp -d "${TMPDIR:-/tmp}/gk-run-XXXXXX")"
cleanup() { if [[ "${KEEP_WORK:-0}" != 1 ]]; then rm -rf "${work:?}"; else echo "kept workdir: $work"; fi; }
trap cleanup EXIT

DROP_CLAUDE_MD=$((1 - with_claude_md)) prepare_workdir "$tdir" "$work"

save_base_coverage "$work" "$out"

prompt="You are working in the Tally repository (the current directory). Resolve the GitHub issue below. Make the change, run the tests, and finish with a short summary of what you changed and anything you are unsure about.

Edit files with the Edit and Write tools. Bash is limited to running the tests and the type checker, git status/diff/log, and ls; any other shell command, including redirects and scripts that write files, is denied.

<issue>
$(cat "$tdir/issue.md")
</issue>"
printf '%s\n' "$prompt" > "$out/prompt.txt"

claude_args=(
  -p "$prompt"
  --bare
  --setting-sources project
  --model "$model"
  --output-format json
  --no-session-persistence
  --max-budget-usd "$budget"
  --tools "Read,Edit,Write,Glob,Grep,Bash"
  --permission-mode acceptEdits
  --permission-prompts none
  --allowedTools
    "Bash(npm test:*)" "Bash(npm run test:*)" "Bash(npm run coverage:*)" "Bash(npm run typecheck:*)"
    "Bash(npx vitest:*)" "Bash(npx tsc:*)"
    "Bash(git diff:*)" "Bash(git status:*)" "Bash(git log:*)" "Bash(ls:*)"
)
if [[ $with_claude_md == 1 ]]; then
  # --bare skips CLAUDE.md discovery, so pass the project instructions explicitly.
  claude_args+=(--append-system-prompt-file "$work/CLAUDE.md")
fi

echo "running $task setup $setup ($model) run $run…"
start=$(date +%s)
set +e
# Clean environment: only the Gatekeeper key and the basics. Nothing inherited from the shell
# that started us (including a parent Claude Code session's CLAUDE_CODE_* variables) can change
# which credentials or settings the agent uses.
(cd "$work" && env -i \
    HOME="$HOME" PATH="$PATH" LANG="${LANG:-C.UTF-8}" TERM=dumb TMPDIR="${TMPDIR:-/tmp}" \
    ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    timeout "${AGENT_TIMEOUT:-15m}" claude "${claude_args[@]}" < /dev/null) \
  > "$out/agent.json" 2> "$out/agent.stderr"
agent_exit=$?
set -e
elapsed=$(( $(date +%s) - start ))

# ---- The change, the visible checks, and the truth (the hidden tests) -------
collect_change "$work" "$out"
check_change "$work" "$out"
run_hidden "$tdir" "$work" "$out"

# ---- meta.json ---------------------------------------------------------------
node - "$out" <<JS
const fs = require("node:fs");
const out = process.argv[2];
let agent = {};
try { agent = JSON.parse(fs.readFileSync(out + "/agent.json", "utf8")); } catch {}
const meta = {
  task: "$task", setup: "$setup", run: $run, model: "$model",
  claudeMd: $with_claude_md === 1, budgetUsd: $budget,
  agentExit: $agent_exit, elapsedSec: $elapsed,
  costUsd: agent.total_cost_usd ?? null, turns: agent.num_turns ?? null,
  agentSubtype: agent.subtype ?? null, agentIsError: agent.is_error ?? null,
  terminalReason: agent.terminal_reason ?? null,
  // An API or auth failure says nothing about the agent: exclude the run and redo it.
  valid: agent.terminal_reason !== "api_error" && $agent_exit !== 124,
  visiblePass: $visible_exit === 0, typecheckPass: $typecheck_exit === 0,
  hiddenPass: $hidden_exit === 0,
  finishedAt: new Date().toISOString(),
};
fs.writeFileSync(out + "/meta.json", JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify({ task: meta.task, setup: meta.setup, cost: meta.costUsd, turns: meta.turns,
  visible: meta.visiblePass, hidden: meta.hiddenPass, sec: meta.elapsedSec, valid: meta.valid }));
if (!meta.valid) console.error("INVALID RUN (" + meta.terminalReason + ", exit " + meta.agentExit + "): rerun with FORCE=1");
JS
