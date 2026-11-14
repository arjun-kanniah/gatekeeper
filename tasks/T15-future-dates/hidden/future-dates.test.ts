import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
let groupId: number;
const originalTz = process.env.TZ;

beforeEach(async () => {
  app = await startApp();
  groupId = await makeGroup(app, "alice");
});
afterEach(async () => {
  vi.useRealTimers();
  process.env.TZ = originalTz;
  await app.close();
});

async function statusAt(now: string, spentOn: string, tz = "UTC") {
  process.env.TZ = tz;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  const res = await app.as("alice").post(`/groups/${groupId}/expenses`, expenseBody({ spentOn }));
  vi.useRealTimers();
  return res.status;
}

describe.each([["UTC"], ["Pacific/Kiritimati"], ["Pacific/Honolulu"]])("hidden: future dates (TZ=%s)", (tz) => {
  it("allows up to one day after the UTC date, late in the UTC day", async () => {
    expect(await statusAt("2026-11-13T23:30:00Z", "2026-11-13", tz)).toBe(201);
    expect(await statusAt("2026-11-13T23:30:00Z", "2026-11-14", tz)).toBe(201);
    expect(await statusAt("2026-11-13T23:30:00Z", "2026-11-15", tz)).toBe(400);
  });

  it("allows up to one day after the UTC date, early in the UTC day", async () => {
    expect(await statusAt("2026-11-13T00:30:00Z", "2026-11-14", tz)).toBe(201);
    expect(await statusAt("2026-11-13T00:30:00Z", "2026-11-15", tz)).toBe(400);
  });

  it("handles month and year boundaries", async () => {
    expect(await statusAt("2026-12-31T20:00:00Z", "2027-01-01", tz)).toBe(201);
    expect(await statusAt("2026-12-31T20:00:00Z", "2027-01-02", tz)).toBe(400);
    expect(await statusAt("2027-02-28T12:00:00Z", "2027-03-01", tz)).toBe(201);
    expect(await statusAt("2027-02-28T12:00:00Z", "2027-03-02", tz)).toBe(400);
  });

  it("rejects the 2062 typo and allows old dates", async () => {
    expect(await statusAt("2026-11-13T12:00:00Z", "2062-11-01", tz)).toBe(400);
    expect(await statusAt("2026-11-13T12:00:00Z", "2001-01-01", tz)).toBe(201);
  });
});

describe("hidden: future dates are not stored", () => {
  it("does not record a rejected expense", async () => {
    await statusAt("2026-11-13T12:00:00Z", "2026-12-25");
    const list = await app.as("alice").get(`/groups/${groupId}/expenses`);
    expect(list.body.expenses).toEqual([]);
  });
});
