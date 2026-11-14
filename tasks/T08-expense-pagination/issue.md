# Paginate the expense list

Our biggest group has ~4,000 expenses and `GET /groups/:id/expenses` returns all of them. The
mobile app times out.

## Requirements

- `GET /groups/:id/expenses` takes `limit` (1 to 100, default 50) and `cursor`.
- The response is `{ expenses, nextCursor }`. `nextCursor` is a string to pass as `cursor` for
  the next page, or `null` on the last page. Treat it as opaque; the format is up to you.
- The order stays the same: newest `spentOn` first, then most recently added first.
- `from` / `to` still work and combine with paging.
- The app pages through while people are still adding and deleting expenses. Walking the pages
  must never show an expense twice or skip one that existed the whole time.
- A `limit` outside 1–100 or not a whole number, or a `cursor` the server didn't produce: 400.
