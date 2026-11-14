import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

describe("hidden: GET /groups", () => {
  it("lists only groups the caller belongs to", async () => {
    const mine = await makeGroup(app, "alice", ["bob"]);
    await makeGroup(app, "carol", ["dave"]);
    const res = await app.as("bob").get("/groups");
    expect(res.status).toBe(200);
    expect(res.body.groups.map((g: { id: number }) => g.id)).toEqual([mine]);
  });

  it("lists newest first, with member counts", async () => {
    const older = await makeGroup(app, "alice", ["bob", "carol"]);
    const newer = await makeGroup(app, "bob", []);
    const newest = await makeGroup(app, "carol", ["bob", "alice", "dave"]);
    const res = await app.as("bob").get("/groups");
    expect(res.body.groups.map((g: { id: number; memberCount: number }) => [g.id, g.memberCount])).toEqual([
      [newest, 4],
      [newer, 1],
      [older, 3],
    ]);
  });

  it("includes groups the caller owns and groups they were added to", async () => {
    const owned = await makeGroup(app, "alice");
    const added = await makeGroup(app, "bob", ["alice"]);
    const res = await app.as("alice").get("/groups");
    expect(res.body.groups.map((g: { id: number; ownerId: string }) => [g.id, g.ownerId])).toEqual([
      [added, "bob"],
      [owned, "alice"],
    ]);
  });

  it("returns an empty list for someone in no groups", async () => {
    await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("dave").get("/groups");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ groups: [] });
  });

  it("returns the group fields", async () => {
    const id = await makeGroup(app, "alice", [], "EUR");
    const res = await app.as("alice").get("/groups");
    expect(res.body.groups[0]).toMatchObject({ id, name: "Trip", currency: "EUR", ownerId: "alice", memberCount: 1 });
    expect(typeof res.body.groups[0].createdAt).toBe("string");
  });

  it("still requires a token", async () => {
    expect((await fetch(`${app.baseUrl}/groups`)).status).toBe(401);
  });
});
