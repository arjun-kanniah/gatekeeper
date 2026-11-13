# Tally

A small API for splitting shared expenses within a group.

- **Runtime:** Node 24, TypeScript run directly by Node (type stripping), no build step.
- **Storage:** SQLite through `node:sqlite`. Schema lives in `migrations/`.
- **Tests:** Vitest, against a real server on a random port and an in-memory database.

```bash
npm install
npm test            # all tests
npm run coverage    # tests + coverage summary
npm run typecheck   # tsc --noEmit
npm start           # http://localhost:3000, demo tokens tok-alice, tok-bob, tok-carol, tok-dave
```

## API

All requests need `Authorization: Bearer <token>`. Money is always an integer number of cents.

| Method | Path | Notes |
|---|---|---|
| POST | `/groups` | `{ name, currency }`; caller becomes owner and first member |
| GET | `/groups/:id` | group and members (members only; others get 404) |
| POST | `/groups/:id/members` | `{ userId }`; owner only |
| POST | `/groups/:id/expenses` | `{ amountCents, currency, description, spentOn, splitAmong? }` |
| GET | `/groups/:id/expenses?from=&to=` | newest first; `from` and `to` are inclusive dates |
| DELETE | `/groups/:id/expenses/:expenseId` | payer or group owner |
| GET | `/groups/:id/balances` | positive = the group owes you |
| POST | `/groups/:id/settlements` | `{ toUserId, amountCents }`; caller paid `toUserId` |
