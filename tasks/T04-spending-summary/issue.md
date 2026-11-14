# Spending summary for a date range

For the monthly recap email we need totals per member, not the full expense list.

## Requirements

Add `GET /groups/:id/summary?from=&to=`:

```json
{
  "currency": "CAD",
  "from": "2026-10-01",
  "to": "2026-10-31",
  "totalCents": 4500,
  "members": [
    { "userId": "alice", "name": "Alice", "paidCents": 3000, "shareCents": 1500 },
    { "userId": "bob",   "name": "Bob",   "paidCents": 1500, "shareCents": 3000 }
  ]
}
```

- `from` and `to` are optional and work exactly like they do on the expense list: dates in
  `YYYY-MM-DD`, both ends inclusive, 400 if malformed. Echo them back, or `null` when not given.
- `totalCents` is the sum of the expenses in the range. `paidCents` is what the member paid for
  them, `shareCents` is their share of them.
- Every current member is listed, in join order, even if their numbers are zero.
- Members only, like every other group endpoint.

So the recap for October is `?from=2026-10-01&to=2026-10-31`.
