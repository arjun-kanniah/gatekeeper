import type { Db } from "./db.ts";

/** Demo users. Tokens are fixed so tests and local runs can use them. */
export const DEMO_USERS = [
  { id: "alice", name: "Alice", token: "tok-alice" },
  { id: "bob", name: "Bob", token: "tok-bob" },
  { id: "carol", name: "Carol", token: "tok-carol" },
  { id: "dave", name: "Dave", token: "tok-dave" },
] as const;

export function seedUsers(db: Db): void {
  const insert = db.prepare("INSERT OR IGNORE INTO users (id, name, token) VALUES (?, ?, ?)");
  for (const u of DEMO_USERS) insert.run(u.id, u.name, u.token);
}
