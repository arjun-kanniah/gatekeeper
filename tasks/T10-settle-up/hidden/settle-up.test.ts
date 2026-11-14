import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const spend = (groupId: number, who: string, amountCents: number, splitAmong?: string[]) =>
  app.as(who).post(`/groups/${groupId}/expenses`, expenseBody({ amountCents, ...(splitAmong ? { splitAmong } : {}) }));
const settle = (groupId: number, from: string, to: string, amountCents: number) =>
  app.as(from).post(`/groups/${groupId}/settlements`, { toUserId: to, amountCents });
const settleUp = (groupId: number, as = "alice") => app.as(as).get(`/groups/${groupId}/settle-up`);
const t = (fromUserId: string, toUserId: string, amountCents: number) => ({ fromUserId, toUserId, amountCents });

describe("hidden: settle up", () => {
  it("has the debtors pay the creditor, earlier-joined first on ties", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    await spend(id, "alice", 900);
    const res = await settleUp(id, "carol");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ currency: "CAD", transfers: [t("bob", "alice", 300), t("carol", "alice", 300)] });
  });

  it("pairs the biggest debtor with the biggest creditor, not join order", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol", "dave"]);
    await spend(id, "alice", 600, ["carol", "dave"]);
    await spend(id, "bob", 200, ["alice", "dave"]);
    const balances = await app.as("alice").get(`/groups/${id}/balances`);
    const byUser = Object.fromEntries(balances.body.balances.map((b: any) => [b.userId, b.balanceCents]));
    expect(byUser).toEqual({ alice: 500, bob: 200, carol: -300, dave: -400 });
    const res = await settleUp(id);
    expect(res.body.transfers).toEqual([t("dave", "alice", 400), t("carol", "bob", 200), t("carol", "alice", 100)]);
  });

  it("re-picks the biggest creditor after every transfer", async () => {
    // alice +600, bob +300, carol -450, dave -450
    const id = await makeGroup(app, "alice", ["bob", "carol", "dave"]);
    await spend(id, "alice", 600, ["carol", "dave"]);
    await spend(id, "bob", 300, ["carol", "dave"]);
    const res = await settleUp(id);
    expect(res.body.transfers).toEqual([t("carol", "alice", 450), t("dave", "bob", 300), t("dave", "alice", 150)]);
  });

  it("counts settlements already recorded", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    await spend(id, "alice", 900);
    expect((await settle(id, "bob", "alice", 300)).status).toBe(201);
    const res = await settleUp(id);
    expect(res.body.transfers).toEqual([t("carol", "alice", 300)]);
  });

  it("counts a partial settlement", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await spend(id, "alice", 1000);
    await settle(id, "bob", "alice", 200);
    const res = await settleUp(id);
    expect(res.body.transfers).toEqual([t("bob", "alice", 300)]);
  });

  it("returns no transfers once everyone is even", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    expect((await settleUp(id)).body.transfers).toEqual([]);
    await spend(id, "alice", 1000);
    await settle(id, "bob", "alice", 500);
    expect((await settleUp(id)).body.transfers).toEqual([]);
  });

  it("is for members only", async () => {
    const id = await makeGroup(app, "alice");
    expect((await settleUp(id, "dave")).status).toBe(404);
  });
});
