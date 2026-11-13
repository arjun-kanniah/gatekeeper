import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const balances = async (groupId: number) => {
  const res = await app.as("alice").get(`/groups/${groupId}/balances`);
  return Object.fromEntries(
    res.body.balances.map((b: { userId: string; balanceCents: number }) => [b.userId, b.balanceCents]),
  );
};

describe("hidden: settlements in balances", () => {
  it("a full repayment clears both balances", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000 }));
    await app.as("bob").post(`/groups/${id}/settlements`, { toUserId: "alice", amountCents: 500 });
    expect(await balances(id)).toEqual({ alice: 0, bob: 0 });
  });

  it("a partial repayment reduces the debt", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900 }));
    await app.as("bob").post(`/groups/${id}/settlements`, { toUserId: "alice", amountCents: 100 });
    expect(await balances(id)).toEqual({ alice: 500, bob: -200, carol: -300 });
  });

  it("paying someone you don't owe creates a debt in the other direction", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await app.as("alice").post(`/groups/${id}/settlements`, { toUserId: "bob", amountCents: 250 });
    expect(await balances(id)).toEqual({ alice: 250, bob: -250 });
  });

  it("balances always sum to zero", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900 }));
    await app.as("bob").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 600 }));
    await app.as("carol").post(`/groups/${id}/settlements`, { toUserId: "alice", amountCents: 300 });
    await app.as("bob").post(`/groups/${id}/settlements`, { toUserId: "carol", amountCents: 50 });
    const all = await balances(id);
    expect(Object.values(all).reduce((a, b) => (a as number) + (b as number), 0)).toBe(0);
    // alice +600-200-300 = 100; bob -300+400+50 = 150; carol -300-200+300-50 = -250
    expect(all).toEqual({ alice: 100, bob: 150, carol: -250 });
  });

  it("still credits the payer of an expense", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900 }));
    expect(await balances(id)).toEqual({ alice: 600, bob: -300, carol: -300 });
  });
});
