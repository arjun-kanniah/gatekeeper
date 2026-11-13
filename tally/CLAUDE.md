# Working in Tally

Tally is a small expense-splitting API (Node 24, TypeScript, `node:sqlite`, Vitest). See README.md
for the API.

## Commands

- `npm test` runs every test. `npx vitest run tests/<file>` runs one file.
- `npm run typecheck` must pass.
- You cannot install packages in this environment.

## Rules

1. **Fix the code, not the tests.** If a test fails, assume the test describes the intended
   behaviour. Never delete, skip (`.skip`, `.only`, `.todo`) or loosen an existing test or
   assertion. If you believe a test is wrong, leave it unchanged and say so in your final message.
2. **Add tests for what you change.** New behaviour and bug fixes get a test that would have
   failed before your change.
3. **Migrations are append-only.** Never edit a file in `migrations/` that already exists. Schema
   changes go in a new file with the next number, e.g. `migrations/002_add_x.sql`.
4. **Don't touch these without being asked:** `src/auth.ts`, `tests/helpers.ts`,
   `vitest.config.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, anything under `.github/`.
5. **No new dependencies.** Use the standard library and what's already in `package.json`.
6. **Money is integer cents.** Never use floats for amounts. Shares of an expense must add up
   exactly to its amount.
7. **Keep the change small.** Change only what the task needs. No drive-by refactors or renames.
8. **If the task is unclear,** make the smallest change that is clearly correct and list your
   open questions in your final message instead of guessing.

## Code conventions

- Validation helpers live in `src/validate.ts`; errors are thrown as `HttpError` from `src/http.ts`.
- Routes are registered in `src/app.ts`; data access lives in the module for that resource.
- Non-members get 404 for a group, not 403, so ids can't be probed.
- Import local files with the `.ts` extension.
