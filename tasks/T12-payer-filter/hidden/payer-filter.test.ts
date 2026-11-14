import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const names = (res: { body: { expenses: { description: string }[] } }) => res.body.expenses.map((e) => e.description);

async function seed() {
  const id = await makeGroup(app, "alice", ["bob", "carol"]);
  const add = (who: string, description: string, spentOn: string) =>
    app.as(who).post(`/groups/${id}/expenses`, expenseBody({ description, spentOn }));
  await add("bob", "b1", "2026-10-01");
  await add("alice", "a1", "2026-10-02");
  await add("bob", "b2", "2026-10-03");
  await add("carol", "c1", "2026-10-03");
  await add("bob", "b3", "2026-10-05");
  return id;
}

describe("hidden: payer filter", () => {
  it("lists only what that member paid, newest first", async () => {
    const id = await seed();
    expect(names(await app.as("alice").get(`/groups/${id}/expenses?payer=bob`))).toEqual(["b3", "b2", "b1"]);
    expect(names(await app.as("bob").get(`/groups/${id}/expenses?payer=carol`))).toEqual(["c1"]);
  });

  it("combines with from", async () => {
    const id = await seed();
    expect(names(await app.as("alice").get(`/groups/${id}/expenses?payer=bob&from=2026-10-02`))).toEqual(["b3", "b2"]);
  });

  it("returns an empty list for a member who paid nothing", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody());
    const res = await app.as("alice").get(`/groups/${id}/expenses?payer=bob`);
    expect(res.status).toBe(200);
    expect(res.body.expenses).toEqual([]);
  });

  it("rejects a payer who isn't a member", async () => {
    const id = await seed();
    expect((await app.as("alice").get(`/groups/${id}/expenses?payer=dave`)).status).toBe(400);
    expect((await app.as("alice").get(`/groups/${id}/expenses?payer=nobody`)).status).toBe(400);
  });
});

describe("hidden: expenses behave as before", () => {
  it("orders same-day expenses newest first", async () => {
    const id = await seed();
    expect(names(await app.as("alice").get(`/groups/${id}/expenses`))).toEqual(["b3", "c1", "b2", "a1", "b1"]);
  });

  it("orders shares by join order whatever order splitAmong uses", async () => {
    const id = await makeGroup(app, "alice", ["carol", "bob"]);
    const res = await app
      .as("bob")
      .post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900, splitAmong: ["bob", "alice", "carol"] }));
    expect(res.body.shares.map((s: { userId: string }) => s.userId)).toEqual(["alice", "carol", "bob"]);
    const list = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(list.body.expenses[0].shares.map((s: { userId: string }) => s.userId)).toEqual(["alice", "carol", "bob"]);
  });

  it("keeps the full expense shape", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await app.as("bob").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000 }));
    const res = await app.as("alice").get(`/groups/${id}/expenses?payer=bob`);
    expect(Object.keys(res.body.expenses[0]).sort()).toEqual(
      ["amountCents", "createdAt", "currency", "description", "groupId", "id", "payerId", "shares", "spentOn"].sort(),
    );
    expect(res.body.expenses[0]).toMatchObject({ groupId: id, payerId: "bob", amountCents: 1000, currency: "CAD" });
  });

  it("only lets the payer or owner delete", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const created = await app.as("carol").post(`/groups/${id}/expenses`, expenseBody());
    expect((await app.as("bob").delete(`/groups/${id}/expenses/${created.body.id}`)).status).toBe(403);
    expect((await app.as("alice").delete(`/groups/${id}/expenses/${created.body.id}`)).status).toBe(204);
    expect((await app.as("alice").delete(`/groups/${id}/expenses/${created.body.id}`)).status).toBe(404);
  });

  it("can't see or delete another group's expense", async () => {
    const mine = await makeGroup(app, "alice");
    const theirs = await makeGroup(app, "carol");
    const created = await app.as("carol").post(`/groups/${theirs}/expenses`, expenseBody());
    expect((await app.as("alice").delete(`/groups/${mine}/expenses/${created.body.id}`)).status).toBe(404);
  });
});
