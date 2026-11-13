import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { splitEqually } from "../../src/split.ts";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

const shares = (amount: number, n: number) =>
  [...splitEqually(amount, Array.from({ length: n }, (_, i) => `u${i}`)).values()];

describe("hidden: splitEqually rounding", () => {
  it.each([
    [10000, 3, [3334, 3333, 3333]],
    [200, 3, [67, 67, 66]],
    [1, 3, [1, 0, 0]],
    [2, 3, [1, 1, 0]],
    [1001, 4, [251, 250, 250, 250]],
    [999, 7, [143, 143, 143, 143, 143, 142, 142]],
  ])("splits %i among %i as %j", (amount, n, expected) => {
    expect(shares(amount, n)).toEqual(expected);
  });

  it("always sums to the amount and differs by at most one cent", () => {
    for (let n = 1; n <= 9; n++) {
      for (const amount of [1, 7, 99, 100, 101, 12345, 99999, 1000003]) {
        const s = shares(amount, n);
        expect(s.reduce((a, b) => a + b, 0)).toBe(amount);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
        expect(s.every(Number.isInteger)).toBe(true);
      }
    }
  });

  it("keeps the order of the member ids it was given", () => {
    expect([...splitEqually(10, ["c", "a", "b"]).entries()]).toEqual([
      ["c", 4],
      ["a", 3],
      ["b", 3],
    ]);
  });
});

describe("hidden: rounding through the API", () => {
  let app: TestApp;
  beforeEach(async () => {
    app = await startApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it("gives the extra cent to the earliest member and balances sum to zero", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const res = await app.as("carol").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 10000 }));
    expect(res.body.shares).toEqual([
      { userId: "alice", shareCents: 3334 },
      { userId: "bob", shareCents: 3333 },
      { userId: "carol", shareCents: 3333 },
    ]);
    const bal = await app.as("alice").get(`/groups/${id}/balances`);
    const total = bal.body.balances.reduce((a: number, b: { balanceCents: number }) => a + b.balanceCents, 0);
    expect(total).toBe(0);
  });

  it("uses join order among splitAmong participants, not request order", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol", "dave"]);
    const res = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ amountCents: 200, splitAmong: ["dave", "carol", "bob"] }));
    expect(res.body.shares).toEqual([
      { userId: "bob", shareCents: 67 },
      { userId: "carol", shareCents: 67 },
      { userId: "dave", shareCents: 66 },
    ]);
  });

  it("does not overcharge on $2.00 three ways", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 200 }));
    const sum = res.body.shares.reduce((a: number, s: { shareCents: number }) => a + s.shareCents, 0);
    expect(sum).toBe(200);
  });
});
