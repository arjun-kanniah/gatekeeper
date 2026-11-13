import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "./helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

describe("creating expenses", () => {
  it("splits evenly among all members by default", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900 }));
    expect(res.status).toBe(201);
    expect(res.body.payerId).toBe("alice");
    expect(res.body.shares).toEqual([
      { userId: "alice", shareCents: 300 },
      { userId: "bob", shareCents: 300 },
      { userId: "carol", shareCents: 300 },
    ]);
  });

  it("splits among a subset when splitAmong is given", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const res = await app
      .as("bob")
      .post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000, splitAmong: ["carol", "bob"] }));
    expect(res.status).toBe(201);
    expect(res.body.shares).toEqual([
      { userId: "bob", shareCents: 500 },
      { userId: "carol", shareCents: 500 },
    ]);
  });

  it("rejects splitting with a non-member", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ splitAmong: ["alice", "dave"] }));
    expect(res.status).toBe(400);
  });

  it.each([
    ["a float amount", { amountCents: 12.5 }],
    ["a zero amount", { amountCents: 0 }],
    ["a bad date", { spentOn: "2026-02-30" }],
    ["a missing description", { description: "" }],
  ])("rejects %s", async (_label, override) => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody(override));
    expect(res.status).toBe(400);
  });

  it("does not let non-members add expenses", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("dave").post(`/groups/${id}/expenses`, expenseBody());
    expect(res.status).toBe(404);
  });
});

describe("listing expenses", () => {
  it("lists newest first", async () => {
    const id = await makeGroup(app, "alice");
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ spentOn: "2026-10-01", description: "A" }));
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ spentOn: "2026-10-05", description: "B" }));
    const res = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(res.body.expenses.map((e: { description: string }) => e.description)).toEqual(["B", "A"]);
  });

  it("filters from a start date", async () => {
    const id = await makeGroup(app, "alice");
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ spentOn: "2026-10-01", description: "A" }));
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ spentOn: "2026-10-05", description: "B" }));
    const res = await app.as("alice").get(`/groups/${id}/expenses?from=2026-10-02`);
    expect(res.body.expenses.map((e: { description: string }) => e.description)).toEqual(["B"]);
  });

  it("rejects a malformed date filter", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").get(`/groups/${id}/expenses?from=yesterday`);
    expect(res.status).toBe(400);
  });
});

describe("deleting expenses", () => {
  it("lets the payer delete", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const created = await app.as("bob").post(`/groups/${id}/expenses`, expenseBody());
    const res = await app.as("bob").delete(`/groups/${id}/expenses/${created.body.id}`);
    expect(res.status).toBe(204);
  });

  it("lets the owner delete someone else's expense", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const created = await app.as("bob").post(`/groups/${id}/expenses`, expenseBody());
    const res = await app.as("alice").delete(`/groups/${id}/expenses/${created.body.id}`);
    expect(res.status).toBe(204);
  });

  it("stops other members from deleting", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const created = await app.as("bob").post(`/groups/${id}/expenses`, expenseBody());
    const res = await app.as("carol").delete(`/groups/${id}/expenses/${created.body.id}`);
    expect(res.status).toBe(403);
  });
});
