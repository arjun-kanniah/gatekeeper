import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.ts";
import { openDb, type Db } from "../src/db.ts";
import { seedUsers } from "../src/seed.ts";

export interface TestApp {
  db: Db;
  baseUrl: string;
  close: () => Promise<void>;
  /** A client that calls the API as the given demo user ("alice", "bob", ...). */
  as: (userId: string) => Client;
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

export interface Client {
  get: <T = any>(path: string) => Promise<ApiResponse<T>>;
  post: <T = any>(path: string, body?: unknown) => Promise<ApiResponse<T>>;
  delete: <T = any>(path: string) => Promise<ApiResponse<T>>;
}

/** Starts Tally on a random port with a fresh in-memory database and the demo users. */
export async function startApp(): Promise<TestApp> {
  const db = openDb(":memory:");
  seedUsers(db);
  const server: Server = createServer(createApp(db));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  return {
    db,
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
    as: (userId: string) => {
      const token = `tok-${userId}`;
      return {
        get: (path) => call(token, "GET", path),
        post: (path, body) => call(token, "POST", path, body ?? {}),
        delete: (path) => call(token, "DELETE", path),
      };
    },
  };
}

/** Creates a group owned by `owner` with the given extra members, in that join order. */
export async function makeGroup(
  app: TestApp,
  owner: string,
  others: string[] = [],
  currency = "CAD",
): Promise<number> {
  const res = await app.as(owner).post("/groups", { name: "Trip", currency });
  if (res.status !== 201) throw new Error(`makeGroup failed: ${res.status}`);
  for (const userId of others) {
    const added = await app.as(owner).post(`/groups/${res.body.id}/members`, { userId });
    if (added.status !== 201) throw new Error(`add member failed: ${added.status}`);
  }
  return res.body.id;
}

export function expenseBody(overrides: Record<string, unknown> = {}) {
  return {
    amountCents: 900,
    currency: "CAD",
    description: "Groceries",
    spentOn: "2026-11-01",
    ...overrides,
  };
}
