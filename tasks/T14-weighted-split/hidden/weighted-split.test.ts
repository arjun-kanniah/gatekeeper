import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

async function weighted(amountCents: number, splitWeights: unknown, members = ["bob", "carol"]) {
  const id = await makeGroup(app, "alice", members);
  return app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents, splitWeights }));
}

const shares = (res: { body: { shares: { userId: string; shareCents: number }[] } }) =>
  res.body.shares.map((s) => [s.userId, s.shareCents]);

describe("hidden: weighted splits", () => {
  it("splits the issue's example exactly", async () => {
    const res = await weighted(50000, { alice: 2, bob: 2, carol: 1 });
    expect(res.status).toBe(201);
    expect(shares(res)).toEqual([["alice", 20000], ["bob", 20000], ["carol", 10000]]);
  });

  it("gives the leftover cent to the largest fractional part", async () => {
    // 1000 * 2/3 = 666.67, 1000 * 1/3 = 333.33 -> alice gets the cent
    expect(shares(await weighted(1000, { alice: 2, bob: 1 }))).toEqual([["alice", 667], ["bob", 333]]);
    // 1001 * 1/4 = 250.25, 1001 * 3/4 = 750.75 -> bob gets the cent, even though alice joined first
    expect(shares(await weighted(1001, { alice: 1, bob: 3 }))).toEqual([["alice", 250], ["bob", 751]]);
  });

  it("breaks ties by join order, not by the order of the keys", async () => {
    // 100 / 3 = 33.33 each; one cent left; carol joined before bob here
    const res = await weighted(100, { bob: 1, carol: 1, alice: 1 }, ["carol", "bob"]);
    expect(shares(res)).toEqual([["alice", 34], ["carol", 33], ["bob", 33]]);
    // two cents left among equal fractions: the two earliest joiners
    const res2 = await weighted(5, { bob: 1, carol: 1, alice: 1 }, ["carol", "bob"]);
    expect(shares(res2)).toEqual([["alice", 2], ["carol", 2], ["bob", 1]]);
  });

  it("uses exact remainders, not floating-point ones", async () => {
    // 7 * 1/7 etc. are exact in integers but noisy as floats: weights 3,3,1 of 70 = 30, 30, 10
    expect(shares(await weighted(70, { alice: 3, bob: 3, carol: 1 }))).toEqual([["alice", 30], ["bob", 30], ["carol", 10]]);
    // 10 * 1/3 = 3.333.., 10 * 2/3 = 6.666..: remainders 1/3 and 2/3
    expect(shares(await weighted(10, { alice: 1, bob: 2 }))).toEqual([["alice", 3], ["bob", 7]]);
    // 101 split 49/51 of 100: 49.49 and 51.51 -> 49 + 51 = 100, one left, bob (.51)
    expect(shares(await weighted(101, { alice: 49, bob: 51 }))).toEqual([["alice", 49], ["bob", 52]]);
  });

  it("only includes the members listed", async () => {
    const res = await weighted(900, { carol: 1, alice: 2 });
    expect(shares(res)).toEqual([["alice", 600], ["carol", 300]]);
  });

  it("always adds up to the amount", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol", "dave"]);
    for (const [amountCents, w] of [
      [1, { alice: 1, bob: 1, carol: 1, dave: 1 }],
      [99, { alice: 7, bob: 3, carol: 5, dave: 11 }],
      [12345, { alice: 100, bob: 1, carol: 33, dave: 66 }],
      [99999, { alice: 13, bob: 17, carol: 19, dave: 23 }],
    ] as const) {
      const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents, splitWeights: w }));
      expect(res.status).toBe(201);
      const sum = res.body.shares.reduce((a: number, s: { shareCents: number }) => a + s.shareCents, 0);
      expect(sum).toBe(amountCents);
      expect(res.body.shares.every((s: { shareCents: number }) => Number.isInteger(s.shareCents))).toBe(true);
    }
  });

  it("feeds into balances", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000, splitWeights: { alice: 2, bob: 1 } }));
    const res = await app.as("bob").get(`/groups/${id}/balances`);
    expect(Object.fromEntries(res.body.balances.map((b: any) => [b.userId, b.balanceCents]))).toEqual({ alice: 333, bob: -333 });
  });

  it.each([
    ["an empty object", {}],
    ["a zero weight", { alice: 0, bob: 1 }],
    ["a negative weight", { alice: -1, bob: 2 }],
    ["a fractional weight", { alice: 1.5, bob: 1 }],
    ["a weight over 100", { alice: 101, bob: 1 }],
    ["a string weight", { alice: "2", bob: 1 }],
    ["a non-member", { alice: 1, dave: 1 }],
    ["an array", ["alice", "bob"]],
    ["null", null],
  ])("rejects %s", async (_label, w) => {
    const res = await weighted(1000, w);
    expect(res.status).toBe(400);
  });

  it("rejects splitAmong and splitWeights together", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ splitAmong: ["alice"], splitWeights: { alice: 1 } }));
    expect(res.status).toBe(400);
  });

  it("leaves equal splits alone", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900, splitAmong: ["carol", "alice"] }));
    expect(shares(res)).toEqual([["alice", 450], ["carol", 450]]);
  });
});
