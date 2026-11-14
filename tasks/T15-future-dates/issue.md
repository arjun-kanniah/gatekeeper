# Reject expenses dated in the future

Typos like `2062-11-01` instead of `2026-11-01` keep happening. Because the list is newest
first, the typo sits at the top of the list for 36 years.

## Requirements

- Reject an expense whose `spentOn` is in the future, with 400.
- Our members are everywhere from UTC−12 to UTC+14, so "today" depends on who's asking, and the
  server doesn't know the caller's timezone. Rule: `spentOn` may be at most **one day after
  today's date in UTC**. So at 2026-11-13 23:30 UTC, `2026-11-14` is fine and `2026-11-15` is
  rejected. At 2026-11-13 00:30 UTC it's the same: `2026-11-14` fine, `2026-11-15` rejected.
- Past dates are fine, however old.
- The server's own timezone setting must not change the result.
