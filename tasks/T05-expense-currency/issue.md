# Balances are nonsense after a USD expense in a CAD group

Someone in our ski-trip group (CAD) added a $120 dinner with `"currency": "USD"`. The balances
now treat it as 120 CAD, and nobody noticed for a week. Tally doesn't do exchange rates, and
it shouldn't start now.

## Requirements

- An expense must be in its group's currency. If the request sends a different currency,
  reject it with status 400 and error code `currency_mismatch` (the `error` field of the
  response body), and a message that names both currencies.
- Most clients only ever have one currency per group, so make `currency` optional when adding
  an expense. If it is left out, use the group's currency.
- A malformed currency (like `"usd"` or `"US"`) is still an ordinary 400 `bad_request`.
- The expense in the response always includes `currency`.

We'll fix the existing bad rows by hand; no data migration needed.
