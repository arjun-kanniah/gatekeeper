import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const remove = (actor: string, groupId: number, userId: string) =>
  app.as(actor).delete(`/groups/${groupId}/members/${userId}`);

/** alice, bob, carol; bob is owed and owes the same, so his balance is zero. */
async function evenGroup() {
  const id = await makeGroup(app, "alice", ["bob", "carol"]);
  await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000, splitAmong: ["alice", "bob"], description: "A" }));
  await app.as("bob").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000, splitAmong: ["alice", "bob"], description: "B" }));
  return id;
}

describe("hidden: removing members", () => {
  it("lets the owner remove a member with a zero balance", async () => {
    const id = await evenGroup();
    expect((await remove("alice", id, "bob")).status).toBe(204);
    const group = await app.as("alice").get(`/groups/${id}`);
    expect(group.body.members.map((m: { userId: string }) => m.userId)).toEqual(["alice", "carol"]);
    const balances = await app.as("alice").get(`/groups/${id}/balances`);
    expect(balances.body.balances.map((b: { userId: string }) => b.userId)).toEqual(["alice", "carol"]);
  });

  it("keeps the departed member's shares in past expenses", async () => {
    const id = await evenGroup();
    await remove("bob", id, "bob");
    const list = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(list.body.expenses).toHaveLength(2);
    for (const e of list.body.expenses) {
      expect(e.shares).toEqual([
        { userId: "alice", shareCents: 500 },
        { userId: "bob", shareCents: 500 },
      ]);
      const sum = e.shares.reduce((a: number, s: { shareCents: number }) => a + s.shareCents, 0);
      expect(sum).toBe(e.amountCents);
    }
  });

  it("keeps balances adding up to zero after someone leaves", async () => {
    const id = await evenGroup();
    await remove("bob", id, "bob");
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 600 }));
    const balances = await app.as("carol").get(`/groups/${id}/balances`);
    const byUser = Object.fromEntries(balances.body.balances.map((b: any) => [b.userId, b.balanceCents]));
    expect(byUser).toEqual({ alice: 300, carol: -300 });
  });

  it("locks the departed member out and leaves them out of new splits", async () => {
    const id = await evenGroup();
    await remove("alice", id, "bob");
    expect((await app.as("bob").get(`/groups/${id}`)).status).toBe(404);
    expect((await app.as("bob").post(`/groups/${id}/expenses`, expenseBody())).status).toBe(404);
    const created = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 600 }));
    expect(created.body.shares.map((s: { userId: string }) => s.userId)).toEqual(["alice", "carol"]);
    const withBob = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ splitAmong: ["alice", "bob"] }));
    expect(withBob.status).toBe(400);
  });

  it("lets the owner add a departed member back", async () => {
    const id = await evenGroup();
    await remove("bob", id, "bob");
    const again = await app.as("alice").post(`/groups/${id}/members`, { userId: "bob" });
    expect(again.status).toBe(201);
    expect((await app.as("bob").get(`/groups/${id}`)).status).toBe(200);
    const list = await app.as("bob").get(`/groups/${id}/expenses`);
    expect(list.body.expenses[0].shares).toHaveLength(2);
  });

  it("refuses to remove a member who still owes or is owed", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000 }));
    expect((await remove("alice", id, "bob")).status).toBe(409);
    expect((await remove("bob", id, "bob")).status).toBe(409);
    const group = await app.as("alice").get(`/groups/${id}`);
    expect(group.body.members).toHaveLength(2);
  });

  it("enforces who may remove whom", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    expect((await remove("bob", id, "carol")).status).toBe(403);
    expect((await remove("alice", id, "alice")).status).toBe(400);
    expect((await remove("alice", id, "dave")).status).toBe(404);
    expect((await remove("dave", id, "bob")).status).toBe(404);
    expect((await remove("carol", id, "carol")).status).toBe(204);
  });
});
