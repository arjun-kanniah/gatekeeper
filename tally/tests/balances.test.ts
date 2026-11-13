import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "./helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const byUser = (balances: { userId: string; balanceCents: number }[]) =>
  Object.fromEntries(balances.map((b) => [b.userId, b.balanceCents]));

describe("balances", () => {
  it("credits the payer and debits each share", async () => {
    const id = await makeGroup(app, "alice", ["bob", "carol"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 900 }));
    const res = await app.as("bob").get(`/groups/${id}/balances`);
    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("CAD");
    expect(byUser(res.body.balances)).toEqual({ alice: 600, bob: -300, carol: -300 });
  });

  it("is zero for everyone in a new group", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("alice").get(`/groups/${id}/balances`);
    expect(byUser(res.body.balances)).toEqual({ alice: 0, bob: 0 });
  });
});

describe("settlements", () => {
  it("records a settlement", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("bob").post(`/groups/${id}/settlements`, { toUserId: "alice", amountCents: 300 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ fromUserId: "bob", toUserId: "alice", amountCents: 300 });
  });

  it("rejects settling with yourself", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("bob").post(`/groups/${id}/settlements`, { toUserId: "bob", amountCents: 300 });
    expect(res.status).toBe(400);
  });

  it("rejects settling with a non-member", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("bob").post(`/groups/${id}/settlements`, { toUserId: "dave", amountCents: 300 });
    expect(res.status).toBe(400);
  });
});
