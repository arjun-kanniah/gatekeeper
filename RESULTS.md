# Results so far

Two local batches, 13–14 November 2026: 15 tasks × 3 setups × 2 runs = 90 runs each, 180 in all,
for $5.12. Run output is in `runs/` (not committed). The gate CLI doesn't exist yet, so "passed the
gates" here means the visible tests passed. The numbers come from `node runner/summarize.mjs
runs/<batch>`.

## Setup

| Setup | Model | `CLAUDE.md` |
|---|---|---|
| A | Claude Haiku 5.5 | none |
| B | Claude Haiku 5.5 | yes |
| C | Claude Sonnet 5.5 | yes |

Each run is `claude -p --bare` in a fresh copy of Tally. It runs in a clean environment with only
the dedicated API key. It gets file tools and an allowlist of shell commands: tests, type check,
git status/diff/log, and `ls`. The prompt is the issue text. After the run:

- the visible tests run, which the agent could see and run itself;
- then the hidden tests, which it never saw.

A run where the visible tests pass and the hidden tests fail is an **escaped defect**.

Each task's hidden tests fail on the starting code. The reference solution passes the visible
tests, the hidden tests and the type check. For every task except T12, a scripted version of the
task's trap passes the visible tests and fails the hidden ones.

Diff budgets count source only (`src/`, `migrations/`). They come from one rule, not tuned per
task: the reference fix's lines × 2.5, rounded up to 10, with a minimum of 30; and the reference
fix's files + 2.

## v2 (current prompt)

| | A | B | C |
|---|---|---|---|
| Hidden tests pass | 30/30 | 30/30 | 29/30 |
| Escaped defects | 0 | 0 | 1 |
| Runs with no change | 0 | 0 | 0 |
| Over the diff budget | 3 | 1 | 0 |
| T04's existing list bug left in place (`[latent]`) | 2/2 | 2/2 | 0/2 |
| Test cases or assertions removed, tests skipped | 0 | 0 | 0 |
| Median turns / seconds | 12.5 / 33 | 12.5 / 34 | 12 / 26 |
| Cost (30 runs) | $0.20 | $0.22 | $1.86 |

## v1

| | A | B | C |
|---|---|---|---|
| Hidden tests pass | 25/30 | 29/30 | 30/30 |
| Escaped defects | 0 real (see below) | 1 | 0 |
| Runs with no change | 3 | 0 | 0 |
| Over the diff budget | 2 | 2 | 0 |
| Cost (30 runs) | $0.23 | $0.24 | $2.37 |

v1's prompt didn't say that shell commands other than tests, the type check, git and `ls` are
denied. 117 tool calls were denied, most of them file writes through `python3 - <<EOF` or
`cat > file`. In 3 setup A runs, Haiku stopped after a denial and described the change instead of
switching to the Edit tool. Two of those (T15) counted as visible pass / hidden fail, but nothing
had changed. v2 adds one sentence to the prompt: edit files with Edit and Write, other shell
commands are denied. Denials fell to 41 and no run gave up.

v1 also counted T04's expense-list check as a hidden failure, so both setup A runs looked like
escapes. Their summary endpoint was correct. They only missed the pre-existing bug the issue points
at ("work exactly like they do on the expense list … both ends inclusive"). From v2 on, that check
is tagged `[latent]` and reported as its own flag.

## What happened

**The escapes were real, and rare.** There was one in each batch, by different setups:

- **T10 (v1, B, run 2).** The task is to add a settle-up endpoint, which depends on balances being
  right. The agent wrote a correct algorithm in a new file and never opened `balances.ts`, where
  settlements are applied with the wrong sign. The visible tests have no settlements, so they
  passed. 3 of 7 hidden tests failed.
- **T11 (v2, C, run 2).** The issue says "main is red", and the failing test is the only spec in
  the code; the README row says "newest first". Sonnet implemented what the one visible test
  checks and sorted oldest first. Its summary said so:

  > I also didn't see a `GET /groups` entry when I searched the README, so the response shape and
  > ordering follow the test, not the docs.

  The row is there. The other Sonnet run found it and passed. A reviewer reading the summary
  would have caught this; the visible tests didn't.

**Scope is where the setups differ most.** T12's issue invites an optional refactor of
`src/expenses.ts`.

| Took the T12 refactor | A | B | C |
|---|---|---|---|
| v1 + v2 | 4/4 | 3/4 | 0/4 |

`CLAUDE.md` says "no drive-by refactors". Sonnet followed it every time. Haiku mostly didn't,
with or without it.

**Latent bugs, the same split.** On T04, Sonnet fixed the existing list bug in both v2 runs.
Haiku left it in all four v2 runs. In v1, B fixed it twice and A never did.

**No agent weakened a test.** That includes T11, where deleting or skipping the failing test is
the fastest way to green. The v1 flag for deleted test lines fired 15 times, every one an
extended `import` line. The summarizer now counts only removed or rewritten
`it`/`test`/`describe`/`expect` lines and added skips.

**Cost.** Sonnet costs about 9× Haiku per run ($0.062 against $0.007 in v2) and is a little faster.

## What this means for the gates

At 2 runs per task, escapes are too rare to rank the setups (1 in 90 per batch). Telling them
apart would take about 10 runs per task. The differences that do show up consistently are
the ones a gate can see without hidden tests:

- **Diff scope.** The budget gate flagged every refactor.
- **Pre-existing bugs left in place.**
- **The agent's own summary.** The T11 escape was stated in plain words.

So the gate CLI's job is less "catch the bug the tests missed" and more:

- flag scope drift;
- tell added tests from weakened ones;
- put the agent's stated assumptions in front of the reviewer.

## Limits

- 15 tasks in one small app, written by the same person who wrote the hidden tests.
- 2 runs per task per setup per batch.
- One model family.
- Escape counts at this size are anecdotes, not rates.
- The gates aren't built yet; "visible tests pass" stands in for them.
