import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const withoutCurrency = (overrides: Record<string, unknown> = {}) => {
  const { currency: _drop, ...body } = expenseBody(overrides);
  return body;
};

describe("hidden: expense currency", () => {
  it("rejects a different currency with currency_mismatch", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("bob").post(`/groups/${id}/expenses`, expenseBody({ currency: "USD", amountCents: 12000 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("currency_mismatch");
    expect(res.body.message).toContain("USD");
    expect(res.body.message).toContain("CAD");
  });

  it("does not record the rejected expense", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    await app.as("bob").post(`/groups/${id}/expenses`, expenseBody({ currency: "USD" }));
    const list = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(list.body.expenses).toEqual([]);
    const balances = await app.as("alice").get(`/groups/${id}/balances`);
    expect(balances.body.balances.every((b: { balanceCents: number }) => b.balanceCents === 0)).toBe(true);
  });

  it("defaults to the group's currency when left out", async () => {
    const id = await makeGroup(app, "alice", ["bob"], "EUR");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, withoutCurrency({ amountCents: 1000 }));
    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("EUR");
    const list = await app.as("alice").get(`/groups/${id}/expenses`);
    expect(list.body.expenses[0].currency).toBe("EUR");
  });

  it("accepts the group's own currency when given", async () => {
    const id = await makeGroup(app, "alice", [], "EUR");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ currency: "EUR" }));
    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("EUR");
  });

  it.each([["usd"], ["US"], ["CADX"], [42]])("treats %j as a malformed currency", async (currency) => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ currency }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("bad_request");
  });

  it("still validates the rest of an expense without a currency", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, withoutCurrency({ amountCents: 0 }));
    expect(res.status).toBe(400);
  });
});
