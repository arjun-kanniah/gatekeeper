-- Initial schema. Migrations are append-only: once merged, a migration file is never edited.

CREATE TABLE users (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE
);

CREATE TABLE groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  currency   TEXT NOT NULL CHECK (length(currency) = 3),
  owner_id   TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- id doubles as the join order: lower id = joined earlier.
CREATE TABLE memberships (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id),
  UNIQUE (group_id, user_id)
);

CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  payer_id     TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency     TEXT NOT NULL,
  description  TEXT NOT NULL,
  spent_on     TEXT NOT NULL, -- YYYY-MM-DD
  created_at   TEXT NOT NULL
);

CREATE TABLE expense_shares (
  expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  share_cents INTEGER NOT NULL,
  PRIMARY KEY (expense_id, user_id)
);

CREATE TABLE settlements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user    TEXT NOT NULL REFERENCES users(id),
  to_user      TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at   TEXT NOT NULL
);

CREATE INDEX expenses_group_spent_on ON expenses (group_id, spent_on);
