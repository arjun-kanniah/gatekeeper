import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

const PIZZA = "🍕"; // one code point, two UTF-16 units, four UTF-8 bytes
const CLEF = "𝄞"; // same

describe("hidden: text length limits", () => {
  it("accepts a description of exactly 200 astral characters", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ description: PIZZA.repeat(200) }));
    expect(res.status).toBe(201);
    expect(res.body.description).toBe(PIZZA.repeat(200));
  });

  it("rejects a description of 201 astral characters", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ description: PIZZA.repeat(201) }));
    expect(res.status).toBe(400);
  });

  it("still rejects 201 plain characters", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ description: "x".repeat(201) }));
    expect(res.status).toBe(400);
  });

  it("counts mixed Japanese text and emoji by code point", async () => {
    const id = await makeGroup(app, "alice");
    const text = "日本".repeat(95) + "🍣🍣🍣🍣🍣🍣🍣🍣🍣🍣"; // 190 + 10 = 200
    const res = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ description: text }));
    expect(res.status).toBe(201);
    const over = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ description: text + "!" }));
    expect(over.status).toBe(400);
  });

  it("counts code points, not what renders as one character", async () => {
    const id = await makeGroup(app, "alice");
    const decomposed = "é"; // é as two code points
    const ok = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ description: decomposed.repeat(100) }));
    expect(ok.status).toBe(201);
    const over = await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ description: decomposed.repeat(101) }));
    expect(over.status).toBe(400);
  });

  it("checks length after trimming", async () => {
    const id = await makeGroup(app, "alice");
    const res = await app
      .as("alice")
      .post(`/groups/${id}/expenses`, expenseBody({ description: `   ${"x".repeat(200)}   ` }));
    expect(res.status).toBe(201);
    expect(res.body.description).toBe("x".repeat(200));
  });

  it("applies the same rules to group names (limit 100)", async () => {
    const ok = await app.as("alice").post("/groups", { name: CLEF.repeat(100), currency: "CAD" });
    expect(ok.status).toBe(201);
    const tooLong = await app.as("alice").post("/groups", { name: CLEF.repeat(101), currency: "CAD" });
    expect(tooLong.status).toBe(400);
    const padded = await app.as("alice").post("/groups", { name: `  ${"n".repeat(100)}\t\n`, currency: "CAD" });
    expect(padded.status).toBe(201);
    expect(padded.body.name).toBe("n".repeat(100));
  });
});
