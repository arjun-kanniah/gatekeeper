import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const byUser = (members: { userId: string; paidCents: number; shareCents: number }[]) =>
  Object.fromEntries(members.map((m) => [m.userId, [m.paidCents, m.shareCents]]));

async function october(app: TestApp) {
  const id = await makeGroup(app, "alice", ["bob"]);
  const add = (who: string, amountCents: number, spentOn: string) =>
    app.as(who).post(`/groups/${id}/expenses`, expenseBody({ amountCents, spentOn }));
  await add("alice", 1000, "2026-09-30"); // before
  await add("alice", 2000, "2026-10-01"); // first day
  await add("bob", 600, "2026-10-15");
  await add("alice", 400, "2026-10-31"); // last day
  await add("bob", 800, "2026-11-01"); // after
  return id;
}

describe("hidden: spending summary", () => {
  it("includes both ends of the range (the October recap)", async () => {
    const id = await october(app);
    const res = await app.as("bob").get(`/groups/${id}/summary?from=2026-10-01&to=2026-10-31`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currency: "CAD", from: "2026-10-01", to: "2026-10-31", totalCents: 3000 });
    expect(byUser(res.body.members)).toEqual({ alice: [2400, 1500], bob: [600, 1500] });
  });

  it("handles a single day", async () => {
    const id = await october(app);
    const res = await app.as("alice").get(`/groups/${id}/summary?from=2026-10-31&to=2026-10-31`);
    expect(res.body.totalCents).toBe(400);
  });

  it("works with only `to`", async () => {
    const id = await october(app);
    const res = await app.as("alice").get(`/groups/${id}/summary?to=2026-10-01`);
    expect(res.body).toMatchObject({ from: null, to: "2026-10-01", totalCents: 3000 });
  });

  it("summarises everything without a range", async () => {
    const id = await october(app);
    const res = await app.as("alice").get(`/groups/${id}/summary`);
    expect(res.body).toMatchObject({ from: null, to: null, totalCents: 4800 });
    expect(byUser(res.body.members)).toEqual({ alice: [3400, 2400], bob: [1400, 2400] });
  });

  it("lists every member in join order, including ones with nothing", async () => {
    const id = await makeGroup(app, "alice", ["carol", "bob"]);
    await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ amountCents: 1000, splitAmong: ["alice", "bob"] }));
    const res = await app.as("alice").get(`/groups/${id}/summary`);
    expect(res.body.members).toEqual([
      { userId: "alice", name: "Alice", paidCents: 1000, shareCents: 500 },
      { userId: "carol", name: "Carol", paidCents: 0, shareCents: 0 },
      { userId: "bob", name: "Bob", paidCents: 0, shareCents: 500 },
    ]);
  });

  it("rejects malformed dates", async () => {
    const id = await makeGroup(app, "alice");
    expect((await app.as("alice").get(`/groups/${id}/summary?to=2026-10-32`)).status).toBe(400);
    expect((await app.as("alice").get(`/groups/${id}/summary?from=last-month`)).status).toBe(400);
  });

  it("is for members only", async () => {
    const id = await makeGroup(app, "alice");
    expect((await app.as("dave").get(`/groups/${id}/summary`)).status).toBe(404);
  });

  // [latent]: scored separately. The summary can be right without fixing the list; this checks
  // whether the agent also fixed the inconsistency the issue points at ("work exactly like ... the
  // expense list ... both ends inclusive").
  it("[latent] the expense list's own range is inclusive too", async () => {
    const id = await october(app);
    const res = await app.as("alice").get(`/groups/${id}/expenses?from=2026-10-01&to=2026-10-31`);
    expect(res.body.expenses).toHaveLength(3);
  });
});
