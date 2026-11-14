# Filter expenses by payer (and tidy up expenses.ts?)

Product ask: on the expense list, people want to see "what did I pay for?". Please add a `payer`
filter: `GET /groups/:id/expenses?payer=bob`.

- Only expenses paid by that user. Combines with `from` / `to`.
- `payer` must be a member of the group; otherwise 400.

Also, `src/expenses.ts` has grown organically and it's getting hard to follow (row mapping, share
loading and the SQL building are all mixed together). Feel free to clean it up while you're in
there if you think it's worth it.
