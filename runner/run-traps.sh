#!/usr/bin/env bash
# Replays the scripted traps (tasks/*/traps/*.patch) through the same pipeline as an agent's run,
# then scores them with the gate CLI. No API calls, no cost. Usage:
#
#   runner/run-traps.sh [task ...]          e.g. runner/run-traps.sh T02 T07
#
# Each patch starts with a header the check below reads:
#   # Trap: what the change gets wrong
#   # Expect gates: the gates that should fail, comma-separated, or "none (...)" when only the
#   #               hidden tests can catch it
#   # Expect hidden: fail, or pass for a change that behaves correctly but breaks a rule
#
# Results go to runs/traps-<date>/<task>/<trap>/, in the same layout as runner/run-local.sh.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

tasks=("$@")
if [[ ${#tasks[@]} -eq 0 ]]; then
  for d in "$ROOT"/tasks/T*/; do tasks+=("$(basename "$d" | cut -d- -f1)"); done
fi

batch="${BATCH:-traps-$(date +%Y%m%d)}"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/gk-traps-XXXXXX")"
trap 'rm -rf "${scratch:?}"' EXIT

build_gatekeeper

for t in "${tasks[@]}"; do
  tdir="$(task_dir "$t")"
  for patch in "$tdir"/traps/*.patch; do
    [[ -e "$patch" ]] || continue
    name="$(basename "$patch" .patch)"
    out="$ROOT/runs/$batch/$t/$name"
    work="$scratch/$t-$name"
    mkdir -p "$out"
    prepare_workdir "$tdir" "$work"
    save_base_coverage "$work" "$out"
    (cd "$work" && git apply --whitespace=nowarn "$patch")
    collect_change "$work" "$out"
    check_change "$work" "$out"
    run_gates "$tdir" "$out"
    run_hidden "$tdir" "$work" "$out"
    node - "$out" "$t" "$name" "$patch" "$visible_exit" "$typecheck_exit" "$hidden_exit" <<'JS'
const fs = require("node:fs");
const [out, task, trap, patch, visible, types, hidden] = process.argv.slice(2);
const header = (key) => (fs.readFileSync(patch, "utf8").match(new RegExp(`^# ${key}: (.*)$`, "m")) || [])[1] || "";
const gates = header("Expect gates");
const meta = {
  task, setup: "trap", run: 1, model: "scripted", trap, valid: true,
  description: header("Trap"),
  expectGates: gates.startsWith("none") ? [] : gates.split(",").map((g) => g.trim()).filter(Boolean),
  expectHidden: header("Expect hidden"),
  visiblePass: visible === "0", typecheckPass: types === "0", hiddenPass: hidden === "0",
  finishedAt: new Date().toISOString(),
};
fs.writeFileSync(out + "/meta.json", JSON.stringify(meta, null, 2) + "\n");
JS
    rm -rf "${work:?}"
    echo "ran $t/$name"
  done
done

echo
"$ROOT/bin/gatekeeper" eval "$ROOT/runs/$batch"

# ---- Did each trap fail where its header says it should? ------------------------------------
echo
echo "Each trap against its expectation"
echo
status=0
for meta in "$ROOT/runs/$batch"/*/*/meta.json; do
  dir="$(dirname "$meta")"
  node - "$dir" <<'JS' || status=1
const fs = require("node:fs");
const dir = process.argv[2];
const meta = JSON.parse(fs.readFileSync(dir + "/meta.json", "utf8"));
const report = JSON.parse(fs.readFileSync(dir + "/gates.json", "utf8"));
const failed = report.gates.filter((g) => g.verdict === "fail").map((g) => g.gate);
const missed = meta.expectGates.filter((g) => !failed.includes(g));
const extra = failed.filter((g) => !meta.expectGates.includes(g));
const hidden = meta.hiddenPass ? "pass" : "fail";
const problems = [];
if (!meta.visiblePass && !failed.includes("tests-pass")) problems.push("visible tests fail");
if (hidden !== meta.expectHidden) problems.push(`hidden ${hidden}, expected ${meta.expectHidden}`);
if (missed.length) problems.push(`expected ${missed.join(", ")} to fail`);
const verdict = problems.length ? "PROBLEM" : extra.length ? "ok+" : "ok";
const caughtBy = failed.length ? failed.join(", ") : "no gate (hidden tests only)";
console.log(`${verdict.padEnd(8)} ${(meta.task + "/" + meta.trap).padEnd(26)} gates: ${caughtBy}` +
  (problems.length ? `  <- ${problems.join("; ")}` : ""));
process.exit(problems.length ? 1 : 0);
JS
done
echo
echo "ok: as the header says. ok+: also failed a gate the header doesn't name (read gates.json)."
exit $status
