# "Settle up" suggestions

At the end of a trip people want to know who should pay whom, not a list of balances.

## Requirements

Add `GET /groups/:id/settle-up`, returning `{ currency, transfers }`, where each transfer is
`{ fromUserId, toUserId, amountCents }`.

Use this rule, so the suggestions are predictable:

1. Start from the current balances (`GET /groups/:id/balances`).
2. Take the member who owes the most and the member who is owed the most. The first pays the
   second the smaller of the two amounts. If two members owe (or are owed) the same amount, the
   one who joined the group earlier goes first.
3. Repeat until everyone is at zero. List the transfers in the order they were produced.

Settlements that were already recorded (`POST /groups/:id/settlements`) count. If Bob has
already paid Alice back, settle-up must not tell him to pay again.

Members only. A group where everyone is even returns `transfers: []`.
