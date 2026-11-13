import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { openDb } from "../../src/db.ts";
import { seedUsers } from "../../src/seed.ts";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

describe("hidden: expense notes", () => {
  let app: TestApp;
  beforeEach(async () => {
    app = await startApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("stores trimmed notes and returns them on create and list", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ notes: "  includes tip  " }));
    expect(res.status).toBe(201);
    expect(res.body.notes).toBe("includes tip");
    const list = await app.as("bob").get(`/groups/${id}/expenses`);
    expect(list.body.expenses[0].notes).toBe("includes tip");
  });

  it.each([
    ["missing", {}],
    ["null", { notes: null }],
    ["blank", { notes: "   " }],
  ])("stores %s notes as null", async (_label, extra) => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody(extra));
    expect(res.status).toBe(201);
    expect(res.body.notes).toBeNull();
    const list = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(list.body.expenses[0]).toHaveProperty("notes", null);
  });

  it("accepts exactly 500 characters and rejects 501", async () => {
    const id = await makeGroup(app, "alice");
    const ok = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ notes: "x".repeat(500) }));
    expect(ok.status).toBe(201);
    const tooLong = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ notes: "x".repeat(501) }));
    expect(tooLong.status).toBe(400);
  });

  it("measures length after trimming", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ notes: `  ${"x".repeat(500)}  ` }));
    expect(res.status).toBe(201);
  });

  it("rejects non-string notes", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ notes: 42 }));
    expect(res.status).toBe(400);
  });
});

describe("hidden: notes on an existing database", () => {
  let dir: string;
  let server: Server | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tally-upgrade-"));
  });
  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("upgrades a database created by the original 001 migration", async () => {
    const path = join(dir, "prod.db");

    // A database as production has it today: 001 applied, with data.
    const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL("./fixtures/001_init.original.sql", import.meta.url), "utf8"));
    old.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    old.prepare("INSERT INTO schema_migrations VALUES ('001_init.sql', '2026-01-01T00:00:00Z')").run();
    old.exec(`
      INSERT INTO users (id, name, token) VALUES ('alice', 'Alice', 'tok-alice');
      INSERT INTO groups (id, name, currency, owner_id, created_at) VALUES (1, 'Old', 'CAD', 'alice', '2026-01-01');
      INSERT INTO memberships (group_id, user_id) VALUES (1, 'alice');
      INSERT INTO expenses (group_id, payer_id, amount_cents, currency, description, spent_on, created_at)
        VALUES (1, 'alice', 500, 'CAD', 'Old expense', '2026-01-02', '2026-01-02');
      INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (1, 'alice', 500);
    `);
    old.close();

    // Deploy the new code against it.
    const db = openDb(path);
    seedUsers(db);
    server = createServer(createApp(db));
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const headers = { authorization: "Bearer tok-alice", "content-type": "application/json" };

    const created = await fetch(`${base}/groups/1/expenses`, {
      method: "POST",
      headers,
      body: JSON.stringify(expenseBody({ notes: "after upgrade" })),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).notes).toBe("after upgrade");

    const list = await (await fetch(`${base}/groups/1/expenses`, { headers })).json();
    const old1 = list.expenses.find((e: { description: string }) => e.description === "Old expense");
    expect(old1).toHaveProperty("notes", null);
    db.close();
  });
});
