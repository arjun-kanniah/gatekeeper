import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expenseBody, makeGroup, startApp, type TestApp } from "../helpers.ts";

let app: TestApp;
beforeEach(async () => {
  app = await startApp();
});
afterEach(async () => {
  await app.close();
});

type Page = { expenses: { id: number; description: string }[]; nextCursor: string | null };

async function seed(groupId: number, dates: string[]) {
  const ids: number[] = [];
  for (const [i, spentOn] of dates.entries()) {
    const res = await app.as("alice").post(`/groups/${groupId}/expenses`, expenseBody({ spentOn, description: `e${i}` }));
    ids.push(res.body.id);
  }
  return ids;
}

async function page(groupId: number, query: string): Promise<Page> {
  const res = await app.as("alice").get(`/groups/${groupId}/expenses?${query}`);
  expect(res.status).toBe(200);
  return res.body;
}

async function walk(groupId: number, query: string, between?: (n: number) => Promise<void>) {
  const seen: number[] = [];
  let cursor: string | null = null;
  let n = 0;
  do {
    const q: string = cursor ? `${query}&cursor=${encodeURIComponent(cursor)}` : query;
    const p = await page(groupId, q);
    seen.push(...p.expenses.map((e) => e.id));
    cursor = p.nextCursor;
    if (between) await between(n++);
  } while (cursor && seen.length < 1000);
  return seen;
}

// Lots of same-day expenses, so ordering ties are the norm.
const DATES = ["2026-10-03", "2026-10-01", "2026-10-03", "2026-10-02", "2026-10-03", "2026-10-01", "2026-10-03", "2026-10-02"];

describe("hidden: expense pagination", () => {
  it("walks every expense once, in the usual order", async () => {
    const id = await makeGroup(app, "alice");
    await seed(id, DATES);
    const all = (await page(id, "")).expenses.map((e) => e.id);
    expect(all).toHaveLength(8);
    expect(await walk(id, "limit=3")).toEqual(all);
  });

  it("returns nextCursor null on the last page", async () => {
    const id = await makeGroup(app, "alice");
    await seed(id, DATES.slice(0, 4));
    const first = await page(id, "limit=2");
    expect(first.expenses).toHaveLength(2);
    expect(typeof first.nextCursor).toBe("string");
    const last = await page(id, `limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(last.expenses).toHaveLength(2);
    expect(last.nextCursor).toBeNull();
    expect((await page(id, "limit=10")).nextCursor).toBeNull();
  });

  it("doesn't repeat an expense when a new one is added between pages", async () => {
    const id = await makeGroup(app, "alice");
    const original = await seed(id, DATES);
    const seen = await walk(id, "limit=3", async (n) => {
      if (n === 0) await app.as("alice").post(`/groups/${id}/expenses`, expenseBody({ spentOn: "2026-10-09", description: "late" }));
    });
    expect(new Set(seen).size).toBe(seen.length);
    for (const e of original) expect(seen).toContain(e);
  });

  it("doesn't skip an expense when an earlier one is deleted between pages", async () => {
    const id = await makeGroup(app, "alice");
    await seed(id, DATES);
    const all = (await page(id, "")).expenses.map((e) => e.id);
    const seen = await walk(id, "limit=3", async (n) => {
      if (n === 0) await app.as("alice").delete(`/groups/${id}/expenses/${all[0]}`);
    });
    expect(seen).toEqual(all);
  });

  it("defaults to 50 per page", async () => {
    const id = await makeGroup(app, "alice");
    await seed(id, Array.from({ length: 53 }, () => "2026-10-01"));
    const first = await page(id, "");
    expect(first.expenses).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const rest = await page(id, `cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(rest.expenses).toHaveLength(3);
    expect(rest.nextCursor).toBeNull();
  });

  it("combines with a date range", async () => {
    const id = await makeGroup(app, "alice");
    await seed(id, DATES);
    const seen = await walk(id, "limit=2&from=2026-10-02");
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it.each([["limit=0"], ["limit=101"], ["limit=2.5"], ["limit=ten"], ["cursor=not-a-cursor"], ["cursor="]])(
    "rejects %s",
    async (query) => {
      const id = await makeGroup(app, "alice");
      await seed(id, DATES.slice(0, 2));
      const res = await app.as("alice").get(`/groups/${id}/expenses?${query}`);
      expect(res.status).toBe(400);
    },
  );
});
