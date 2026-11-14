import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
let groupId: number;
beforeEach(async () => {
  app = await startApp();
  groupId = await makeGroup(app, "alice");
});
afterEach(async () => {
  await app.close();
});

const status = async (authorization: string) =>
  (await fetch(`${app.baseUrl}/groups/${groupId}`, { headers: { authorization } })).status;

describe("hidden: bearer scheme", () => {
  it.each([["Bearer tok-alice"], ["bearer tok-alice"], ["BEARER tok-alice"], ["bEaReR tok-alice"], ["Bearer   tok-alice"]])(
    "accepts %j",
    async (header) => {
      expect(await status(header)).toBe(200);
    },
  );

  it.each([
    ["Bearer TOK-ALICE"], // tokens are case-sensitive
    ["bearer Tok-Alice"],
    ["Basic tok-alice"],
    ["tok-alice"],
    ["Bearertok-alice"],
    ["Bearer"],
    ["Bearer "],
    ["Bearer tok-alice tok-bob"],
    ["xBearer tok-alice"],
    ["Token bearer tok-alice"],
  ])("rejects %j", async (header) => {
    expect(await status(header)).toBe(401);
  });

  it("does not match tokens case-insensitively in the database", async () => {
    app.db.prepare("INSERT INTO users (id, name, token) VALUES ('erin', 'Erin', 'Tok-Erin-Secret')").run();
    expect(await status("bearer tok-erin-secret")).toBe(401);
    const res = await fetch(`${app.baseUrl}/groups`, {
      method: "POST",
      headers: { authorization: "bearer Tok-Erin-Secret", "content-type": "application/json" },
      body: JSON.stringify({ name: "E", currency: "CAD" }),
    });
    expect(res.status).toBe(201);
  });
});
