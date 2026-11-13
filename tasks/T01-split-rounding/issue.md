# Splitting $100.00 three ways loses a cent

When Alice adds a $100.00 expense (`amountCents: 10000`) split among three members, each share
comes back as 3333 cents. The shares add up to $99.99, so one cent disappears and the group's
balances no longer add up to zero. With other amounts (e.g. $2.00 three ways) the shares add up
to *more* than the expense.

## Expected

- The shares of an expense always add up to exactly its amount.
- Shares differ from each other by at most one cent.
- When the amount doesn't divide evenly, the extra cents go to the members who joined the
  group earliest, one cent each. For $100.00 split among Alice, Bob and Carol (who joined in
  that order): Alice 3334, Bob 3333, Carol 3333.
- This applies to `splitAmong` too: among the people sharing the expense, the earliest to have
  joined the group get the extra cents.
