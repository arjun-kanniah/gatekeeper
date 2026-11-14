import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

async function patch(as: string, path: string, body: unknown) {
  const res = await fetch(app.baseUrl + path, {
    method: "PATCH",
    headers: { authorization: `Bearer tok-${as}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const byUser = (balances: { userId: string; balanceCents: number }[]) =>
  Object.fromEntries(balances.map((b) => [b.userId, b.balanceCents]));

describe("hidden: editing expenses", () => {
  it("re-splits among the original participants, not the whole group", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const created = await app
      .as("bob")
      .post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900, splitAmong: ["bob", "carol"] }));
    await app.as("alice").post(`/groups/${id}/members`, { userId: "dave" });
    const res = await patch("bob", `/groups/${id}/expenses/${created.body.id}`, { amountCents: 1200 });
    expect(res.status).toBe(200);
    expect(res.body.amountCents).toBe(1200);
    expect(res.body.shares).toEqual([
      { userId: "bob", shareCents: 600 },
      { userId: "carol", shareCents: 600 },
    ]);
    const list = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(list.body.expenses[0].shares).toEqual(res.body.shares);
  });

  it("doesn't pull in members who joined after the expense", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const created = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000 }));
    await app.as("alice").post(`/groups/${id}/members`, { userId: "carol" });
    const res = await patch("alice", `/groups/${id}/expenses/${created.body.id}`, { amountCents: 2000 });
    expect(res.body.shares.map((s: { userId: string }) => s.userId)).toEqual(["alice", "bob"]);
    const balances = await app.as("alice").get(`/groups/${id}/balances`);
    expect(byUser(balances.body.balances)).toEqual({ alice: 1000, bob: -1000, carol: 0 });
  });

  it("leaves shares alone when only the description or date changes", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const created = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ amountCents: 800, splitAmong: ["alice", "carol"] }));
    const res = await patch("alice", `/groups/${id}/expenses/${created.body.id}`, {
      description: "Groceries (Costco)",
      spentOn: "2026-10-30",
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ description: "Groceries (Costco)", spentOn: "2026-10-30", amountCents: 800 });
    expect(res.body.shares).toEqual(created.body.shares);
  });

  it("lets the owner edit someone else's expense but not other members", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const created = await app.as("bob").post(`/groups/${id}/expenses`, expenseBody());
    expect((await patch("carol", `/groups/${id}/expenses/${created.body.id}`, { description: "x" })).status).toBe(403);
    expect((await patch("alice", `/groups/${id}/expenses/${created.body.id}`, { description: "x" })).status).toBe(200);
    expect((await patch("dave", `/groups/${id}/expenses/${created.body.id}`, { description: "x" })).status).toBe(404);
    expect((await patch("alice", `/groups/${id}/expenses/9999`, { description: "x" })).status).toBe(404);
  });

  it.each([
    ["an empty body", {}],
    ["a zero amount", { amountCents: 0 }],
    ["a float amount", { amountCents: 10.5 }],
    ["a bad date", { spentOn: "2026-13-01" }],
    ["a blank description", { description: "  " }],
    ["splitAmong", { splitAmong: ["alice"] }],
    ["payerId", { payerId: "bob" }],
    ["currency", { currency: "USD" }],
  ])("rejects %s", async (_label, body) => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const created = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000 }));
    const res = await patch("alice", `/groups/${id}/expenses/${created.body.id}`, body);
    expect(res.status).toBe(400);
    const list = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(list.body.expenses[0]).toMatchObject({ amountCents: 1000, description: "Groceries" });
  });
});
