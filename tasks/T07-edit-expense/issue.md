# Editing an expense

Typos in amounts are common ("I typed 9000, meant 900"). Today the only fix is to delete the
expense and add it again, which loses who it was split with.

## Requirements

Add `PATCH /groups/:id/expenses/:expenseId` with a JSON body containing any of `amountCents`,
`description` and `spentOn` (same rules as when creating).

- Only the payer or the group owner may edit (403 otherwise). Unknown expense: 404.
  Non-members: 404 for the group.
- A body with none of those fields is a 400. So is a body that tries to change `splitAmong`,
  `payerId` or `currency`: those can't be edited (delete and re-add instead).
- When the amount changes, the shares are recalculated **among the same people who shared the
  expense before**, with the same rules as when it was created. Changing only the description or
  date leaves the shares alone.
- Respond 200 with the updated expense. Balances follow the new amount.
