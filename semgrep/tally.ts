// Annotated examples for semgrep --test. Not part of Tally; never imported.
declare const db: any, groupId: string, clauses: string[], id: string;

declare function readJson(req: unknown): Promise<Record<string, unknown>>;
declare function parseId(raw: string, what: string): number;

async function handler(req: any, params: Record<string, string>, query: URLSearchParams) {
  const body = await readJson(req);
  // ruleid: sql-built-from-request, sql-assembled
  db.prepare(`SELECT * FROM groups WHERE name = '${body.name}'`);
  const payer = query.get("payer");
  // ruleid: sql-built-from-request, sql-assembled
  db.prepare("SELECT * FROM expenses WHERE payer_id = '" + payer + "'");
  // ok: sql-built-from-request
  db.prepare("SELECT * FROM expenses WHERE payer_id = ?").all(payer);
  const gid = parseId(params.groupId, "group");
  const pattern = /^\/groups\/(\d+)$/;
  // ok: sql-built-from-request, sql-assembled
  pattern.exec(req.url);
  // A parsed id is safe, so only the review warning fires.
  // ruleid: sql-assembled
  db.prepare(`SELECT * FROM groups WHERE id = ${gid}`);
}

// ruleid: sql-assembled
db.prepare(`SELECT * FROM expenses WHERE group_id = ${groupId}`);
// ruleid: sql-assembled
db.prepare("SELECT * FROM groups WHERE id = " + id);
// ruleid: sql-assembled
db.exec(`DELETE FROM memberships WHERE user_id = '${id}'`);
// ok: sql-assembled
db.prepare(`SELECT * FROM expenses WHERE ${clauses.join(" AND ")} ORDER BY id`);
// ok: sql-assembled
db.prepare("SELECT * FROM groups WHERE id = ?").get(id);

// ruleid: dynamic-code
eval(id);
// ruleid: dynamic-code
new Function("x", id);

// ruleid: child-process
import { execSync } from "node:child_process";

// ruleid: tls-verification-off
fetch("https://example.com", { agent: { rejectUnauthorized: false } } as any);

// ruleid: weak-random
const token = Math.random().toString(36);

// ruleid: empty-catch
try {
  JSON.parse(id);
} catch {}

// ok: empty-catch
try {
  JSON.parse(id);
} catch {
  throw new Error("bad json");
}
