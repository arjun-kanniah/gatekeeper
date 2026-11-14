# "Description must be at most 200 characters" for a 120-character description

Reported by a user in Japan: a description of about 120 characters (Japanese text plus a few
emoji) was rejected with `description must be at most 200 characters`. Another user pasted a
group name from a spreadsheet; it had trailing spaces and was rejected as too long even though
the name itself was short.

## Expected

- Length limits count **characters as Unicode code points**, not UTF-16 code units or bytes.
  `"🍕"` is one character. `"日本"` is two.
- Text is trimmed before its length is checked (it is already trimmed before it's stored).
- This applies to every text field with a limit, not just expense descriptions.
- The limits themselves don't change: 200 for descriptions, 100 for group names.
