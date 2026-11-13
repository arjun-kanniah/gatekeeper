import type { Db } from "./db.ts";

export interface User {
  id: string;
  name: string;
}

/**
 * Resolves the caller from an `Authorization: Bearer <token>` header.
 * Demo-grade: tokens are stored in plain text. A real service would store a hash.
 */
export function authenticate(db: Db, header: string | undefined): User | null {
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (token === "") return null;
  const row = db.prepare("SELECT id, name FROM users WHERE token = ?").get(token) as
    | { id: string; name: string }
    | undefined;
  return row ? { id: row.id, name: row.name } : null;
}
