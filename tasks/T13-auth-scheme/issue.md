# Mobile client gets 401 with a valid token

The new mobile client's HTTP library sends the header as `authorization: bearer tok-…` (lowercase
scheme), and every request gets 401. The auth scheme is case-insensitive per RFC 9110
(section 11.1), so the client is right and we're wrong.

## Expected

- Accept the `Bearer` scheme in any letter case (`Bearer`, `bearer`, `BEARER`, …), followed by
  one or more spaces and then the token.
- Nothing else about authentication changes. Tokens themselves are still matched exactly; any
  other scheme or a malformed header is still a 401.

This needs a change to `src/auth.ts`; you have the go-ahead to edit it for this.
