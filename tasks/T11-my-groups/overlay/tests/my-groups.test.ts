import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGroup, startApp, type TestApp } from "./helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

describe("my groups", () => {
  it("lists the groups I belong to", async () => {
    const id = await makeGroup(app, "alice", ["bob"]);
    const res = await app.as("bob").get("/groups");
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([
      expect.objectContaining({ id, name: "Trip", currency: "CAD", ownerId: "alice", memberCount: 2 }),
    ]);
  });
});
