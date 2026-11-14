# Uneven splits ("Alice and Bob had two nights, Carol one")

Not every expense is split equally. For the cabin, Alice and Bob stayed two nights and Carol one.

## Requirements

`POST /groups/:id/expenses` accepts `splitWeights` as an alternative to `splitAmong`:

```json
{ "amountCents": 50000, "description": "Cabin", "spentOn": "2026-11-01", "currency": "CAD",
  "splitWeights": { "alice": 2, "bob": 2, "carol": 1 } }
```

- Only the members listed share the expense, in proportion to their weight. The example gives
  Alice 20000, Bob 20000 and Carol 10000.
- Weights are whole numbers from 1 to 100. Every key must be a member of the group. The object
  must not be empty. Sending both `splitAmong` and `splitWeights` is a 400. Any violation is a 400.
- Shares are whole cents and must add up exactly to the amount. Work out each member's exact
  share, give everyone the whole-cent part, and hand out the leftover cents one at a time to the
  members with the largest fractional parts. If two fractional parts are equal, the member who
  joined the group earlier gets the cent first.
- Shares are returned in join order, as they are today.
- Equal splits (no `splitWeights`) keep working exactly as now.
