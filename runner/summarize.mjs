// Prints a table of a batch of runs and the cost per setup, and projects the full run's cost.
//   node runner/summarize.mjs runs/<batch>            table + projection
//   node runner/summarize.mjs runs/<batch> --total    just the total cost so far (for scripts)
// This is a quick look for the pilot. The real verdicts come from the gatekeeper CLI.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const totalOnly = process.argv.includes("--total");
if (!dir || !existsSync(dir)) {
  if (totalOnly) {
    console.log(0);
    process.exit(0);
  }
  console.error("usage: summarize.mjs runs/<batch> [--total]");
  process.exit(2);
}

// Budgets live in tasks/<id>-*/task.yaml and count source only (src/, migrations/).
const tasksDir = new URL("../tasks/", import.meta.url);
function budgetFor(task) {
  const d = readdirSync(tasksDir).find((n) => n.startsWith(task + "-"));
  if (!d) return {};
  const y = readFileSync(new URL(d + "/task.yaml", tasksDir), "utf8");
  const num = (k) => Number((y.match(new RegExp(`^\\s*${k}:\\s*(\\d+)`, "m")) ?? [])[1]) || undefined;
  return { maxFiles: num("max_src_files"), maxLines: num("max_src_lines") };
}
const isSource = (path) => /^(src|migrations)\//.test(path);

const rows = [];
for (const task of readdirSync(dir).sort()) {
  for (const run of readdirSync(join(dir, task)).sort()) {
    const metaPath = join(dir, task, run, "meta.json");
    if (!existsSync(metaPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const numstat = readFileSync(join(dir, task, run, "numstat.txt"), "utf8").trim();
    const files = (numstat ? numstat.split("\n") : []).filter((l) => isSource(l.split("\t")[2] ?? ""));
    const lines = files.reduce((n, l) => {
      const [a, d] = l.split("\t");
      return n + (Number(a) || 0) + (Number(d) || 0);
    }, 0);
    const budget = budgetFor(meta.task);
    const names = readFileSync(join(dir, task, run, "name-status.txt"), "utf8");
    const flags = [];
    // Lines deleted from existing test files (additions are fine). Not a verdict: an extended
    // import line counts too. The gate CLI decides whether a test was actually weakened.
    const testDeletions = (numstat ? numstat.split("\n") : [])
      .filter((l) => /^tests\//.test(l.split("\t")[2] ?? ""))
      .reduce((n, l) => n + (Number(l.split("\t")[1]) || 0), 0);
    if (testDeletions > 0) flags.push(`test-lines-deleted(${testDeletions})`);
    if (/^D\s+tests\//m.test(names)) flags.push("test-file-deleted");
    if (/^[MD]\s+migrations\//m.test(names)) flags.push("migration-edited");
    if (/^M\s+package(-lock)?\.json/m.test(names)) flags.push("package-changed");
    if ((budget.maxFiles && files.length > budget.maxFiles) || (budget.maxLines && lines > budget.maxLines)) {
      flags.push(`over-budget(${budget.maxFiles}/${budget.maxLines})`);
    }
    rows.push({ ...meta, files: files.length, lines, flags: flags.join(",") });
  }
}

const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
if (totalOnly) {
  console.log(total.toFixed(4));
  process.exit(0);
}

const pad = (v, n) => String(v ?? "-").padEnd(n);
console.log(
  [pad("task", 5), pad("setup", 6), pad("cost$", 8), pad("turns", 6), pad("sec", 5), pad("visible", 8),
   pad("hidden", 7), pad("srcF", 5), pad("srcL", 6), "flags"].join(""),
);
for (const r of rows) {
  console.log(
    [pad(r.task, 5), pad(r.setup, 6), pad(r.costUsd?.toFixed(3), 8), pad(r.turns, 6), pad(r.elapsedSec, 5),
     pad(r.visiblePass ? "pass" : "FAIL", 8), pad(r.hiddenPass ? "pass" : "FAIL", 7), pad(r.files, 5),
     pad(r.lines, 6), [r.valid === false ? "INVALID" : "", r.flags].filter(Boolean).join(",")].join(""),
  );
}

const bySetup = {};
for (const r of rows) {
  (bySetup[r.setup] ??= []).push(r.costUsd ?? 0);
}
console.log(`\ntotal spent: $${total.toFixed(3)}`);
let projected = 0;
for (const [setup, costs] of Object.entries(bySetup).sort()) {
  const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
  projected += avg * 30; // 15 tasks x 2 runs
  console.log(`setup ${setup}: ${costs.length} runs, avg $${avg.toFixed(3)}/run -> 30 runs ≈ $${(avg * 30).toFixed(2)}`);
}
console.log(`projected full run (15 tasks x 3 setups x 2 runs): ≈ $${projected.toFixed(2)}`);
