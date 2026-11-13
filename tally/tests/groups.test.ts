import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGroup, startApp, type TestApp } from "./helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    const res = await fetch(`${app.baseUrl}/groups/1`);
    expect(res.status).toBe(401);
  });

  it("rejects an unknown token", async () => {
    const res = await fetch(`${app.baseUrl}/groups/1`, { headers: { authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });
});

describe("groups", () => {
  it("creates a group with the creator as owner and first member", async () => {
    const res = await app.as("alice").post("/groups", { name: "Ski trip", currency: "CAD" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Ski trip", currency: "CAD", ownerId: "alice" });

    const got = await app.as("alice").get(`/groups/${res.body.id}`);
    expect(got.body.members).toEqual([{ userId: "alice", name: "Alice" }]);
  });

  it("validates the currency code", async () => {
    const res = await app.as("alice").post("/groups", { name: "Trip", currency: "cad" });
    expect(res.status).toBe(400);
  });

  it("lists members in join order", async () => {
    const id = await makeGroup(app, "alice", ["carol", "bob"]);
    const got = await app.as("bob").get(`/groups/${id}`);
    expect(got.body.members.map((m: { userId: string }) => m.userId)).toEqual(["alice", "carol", "bob"]);
  });

  it("hides groups from non-members with 404", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("dave").get(`/groups/${id}`);
    expect(res.status).toBe(404);
  });

  it("only lets the owner add members", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("bob").post(`/groups/${id}/members`, { userId: "carol" });
    expect(res.status).toBe(403);
  });

  it("rejects adding the same member twice", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("alice").post(`/groups/${id}/members`, { userId: "bob" });
    expect(res.status).toBe(409);
  });
});
