# Gatekeeper

Release gates for code written by a coding agent, and a measurement of how well they work.

A coding agent (Claude Code, run headless) works on tasks in a small sample app. Each change goes
through a set of gates: tests pass, tests weren't weakened, coverage didn't drop, the diff stays
in scope, protected paths weren't touched, no new dependencies, no static-analysis or secret
findings. Then hidden acceptance tests, which the agent never sees, decide whether the change was
actually right. The headline number is the **escaped-defect rate**: changes that passed every
gate and were still wrong.

> Work in progress. The sample app, 15 tasks and the local runner are in place, and the first
> 180 runs are in [RESULTS.md](RESULTS.md). The gate CLI (Go), the GitHub Actions runner and the
> results site are next.

## Layout

| Path | What |
|---|---|
| `tally/` | The sample app: a small expense-splitting API (TypeScript, `node:sqlite`, Vitest). |
| `tasks/Txx-*/` | One task each: `issue.md` (what the agent sees), `task.yaml` (budgets, what's allowed), `hidden/` (acceptance tests), `overlay/` (files changed before the run), `solution.patch` (a reference fix). |
| `runner/` | Scripts that prepare a clean copy, run the agent, and collect the diff, test results, coverage and cost. |

The hidden tests are in this public repo, so anyone can read them. The agent can't: each run
works in a fresh copy of `tally/` that never contains them.

## Running locally

```bash
cd tally && npm install && cd ..
runner/validate-tasks.sh          # no API calls: checks every task's hidden tests fail on the
                                  # base code and pass with the reference fix
cp .env.example .env              # add an API key with a spend limit
runner/run-local.sh T01 B 1       # one task, one setup, one run
runner/pilot.sh                   # the pilot: 3 tasks x 3 setups
node runner/summarize.mjs runs/<batch>
```

Runs use `claude -p --bare`, so the agent authenticates only with the API key in `.env` and loads
no personal settings or memory. Its tools are limited to reading and editing files in the copy
and running the test, type-check and read-only git commands.

## Setups compared

| Setup | Model | Project instructions (`CLAUDE.md`) |
|---|---|---|
| A | Claude Haiku 5.5 | none |
| B | Claude Haiku 5.5 | yes |
| C | Claude Sonnet 5.5 | yes |
