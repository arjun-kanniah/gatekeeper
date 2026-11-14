# Gatekeeper

Release gates for code written by a coding agent, and a measurement of how well they work.

A coding agent (Claude Code, run headless) works on tasks in a small sample app. Each change goes
through a set of gates: tests pass, tests weren't weakened, coverage didn't drop, the diff stays
in scope, protected paths weren't touched, no new dependencies, no static-analysis or secret
findings. Then hidden acceptance tests, which the agent never sees, decide whether the change was
actually right. The headline number is the **escaped-defect rate**: changes that passed every
gate and were still wrong.

> Work in progress. The sample app, 15 tasks, the local runner and the gate CLI are in place,
> and the first 180 runs are in [RESULTS.md](RESULTS.md). The GitHub Actions runner and the
> results site are next.

## Layout

| Path | What |
|---|---|
| `tally/` | The sample app: a small expense-splitting API (TypeScript, `node:sqlite`, Vitest). |
| `tasks/Txx-*/` | One task each: `issue.md` (what the agent sees), `task.yaml` (budgets, what's allowed), `hidden/` (acceptance tests), `overlay/` (files changed before the run), `solution.patch` (a reference fix). |
| `runner/` | Scripts that prepare a clean copy, run the agent, and collect the diff, test results, coverage and cost. |
| `cmd/gatekeeper/`, `internal/` | The gate CLI (Go, standard library plus a YAML parser). |
| `gates.yaml` | Tally's gate policy: what counts as source and tests, protected paths, migrations, thresholds. |

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

## The gate CLI

`gatekeeper` reads the outputs of tools that already ran (a `git diff`, JUnit XML, coverage
summaries, SARIF) and applies the gates. It runs no tools itself, so it's fast and every gate is
a unit-tested pure function.

```bash
mise install                                   # Go 1.27 and Node 24, pinned in mise.toml
go test ./...
go build -o bin/gatekeeper ./cmd/gatekeeper

bin/gatekeeper check --run runs/<batch>/T07/A-r1        # one run; exit 1 if a gate fails
bin/gatekeeper check --diff change.patch --junit junit.xml \
  --base-coverage base.json --head-coverage head.json --task task.yaml   # any repo, as a CI step
bin/gatekeeper eval runs/<batch>                         # score the gates against the hidden tests
```

| Gate | Reads | Fails when |
|---|---|---|
| `has-change` | the diff | No source file changed (the agent gave up, or only touched docs and tests) |
| `tests-pass` | JUnit XML | Any visible test fails, or none ran |
| `tests-not-weakened` | the diff | A test file is deleted; an existing `it`/`test`/`describe`/`expect` line is removed or rewritten; a `.skip`, `.only` or `.todo` is added. Extending an import line is fine. |
| `coverage` | base and head `coverage-summary.json` | Line coverage drops by more than 0.5 points |
| `diff-size` | the diff + the task's budget | More source files or lines than the budget (tests and docs are free) |
| `protected-paths` | the diff + `gates.yaml` | A protected path changes and the task doesn't allow it |
| `migrations` | the diff | An existing migration changes, or one is added when the task doesn't allow schema changes |
| `dependencies` | `package.json` / lockfile in the diff | A dependency is added and the task doesn't allow it |
| `secrets` | added lines | A line looks like a key, token or private key (the report never prints the value) |
| `static-analysis` | SARIF | A finding at a blocking level in a file the change touched |

A gate whose input wasn't given reports `skip`, not `pass`. `check` exits 0 when every gate
passes, 1 when one fails, and 2 on a usage or input error.

`eval` puts every run of a batch in a confusion matrix: gates pass or fail, against hidden tests
pass or fail. **Escaped** (gates pass, hidden tests fail) is the number that matters. The hidden
tests judge behaviour only, so a gate that fails on a correct change is reported as
**blocked-correct**: noise for a test-based gate, but for a policy gate (scope, protected paths)
usually a real rule broken by a change that still works.

## Setups compared

| Setup | Model | Project instructions (`CLAUDE.md`) |
|---|---|---|
| A | Claude Haiku 5.5 | none |
| B | Claude Haiku 5.5 | yes |
| C | Claude Sonnet 5.5 | yes |
