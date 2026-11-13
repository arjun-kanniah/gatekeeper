# Add optional notes to expenses

People want to jot down details on an expense ("includes tip", "Bob's half of the deposit").

## Requirements

- `POST /groups/:id/expenses` accepts an optional `notes` string.
- Notes are trimmed. Missing, `null`, or empty after trimming is stored as `null`.
- Notes longer than 500 characters (after trimming) are rejected with 400. A non-string value
  is rejected with 400.
- `notes` is returned on the created expense and in `GET /groups/:id/expenses`, as a string or
  `null`. Existing expenses have `notes: null`.
- Production already has data, so this has to work on an existing database.
