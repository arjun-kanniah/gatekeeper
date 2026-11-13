import type { IncomingMessage, ServerResponse } from "node:http";
import type { User } from "./auth.ts";
import { authenticate } from "./auth.ts";
import { groupBalances } from "./balances.ts";
import type { Db } from "./db.ts";
import { createExpense, deleteExpense, listExpenses } from "./expenses.ts";
import { addMember, createGroup, listMembers, requireMemberGroup } from "./groups.ts";
import { badRequest, HttpError, notFound, readJson, sendJson } from "./http.ts";
import { recordSettlement } from "./settlements.ts";
import {
  isIsoDate,
  parseId,
  requireCents,
  requireCurrency,
  requireDate,
  requireString,
} from "./validate.ts";

interface Ctx {
  db: Db;
  user: User;
  params: Record<string, string>;
  query: URLSearchParams;
  req: IncomingMessage;
}

interface Reply {
  status: number;
  body?: unknown;
}

type Handler = (ctx: Ctx) => Reply | Promise<Reply>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:(\w+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      }) +
      "$",
  );
  routes.push({ method, pattern, keys, handler });
}

// ---- Groups -------------------------------------------------------------

route("POST", "/groups", async ({ db, user, req }) => {
  const body = await readJson(req);
  const name = requireString(body, "name", 100);
  const currency = requireCurrency(body, "currency");
  return { status: 201, body: createGroup(db, user.id, name, currency) };
});

route("GET", "/groups/:groupId", ({ db, user, params }) => {
  const group = requireMemberGroup(db, parseId(params.groupId!, "group"), user.id);
  return { status: 200, body: { ...group, members: listMembers(db, group.id) } };
});

route("POST", "/groups/:groupId/members", async ({ db, user, params, req }) => {
  const group = requireMemberGroup(db, parseId(params.groupId!, "group"), user.id);
  const body = await readJson(req);
  const userId = requireString(body, "userId", 64);
  return { status: 201, body: { members: addMember(db, group, user.id, userId) } };
});

// ---- Expenses -----------------------------------------------------------

route("POST", "/groups/:groupId/expenses", async ({ db, user, params, req }) => {
  const group = requireMemberGroup(db, parseId(params.groupId!, "group"), user.id);
  const body = await readJson(req);
  let splitAmong: string[] | undefined;
  if (body.splitAmong !== undefined) {
    if (!Array.isArray(body.splitAmong) || !body.splitAmong.every((x) => typeof x === "string")) {
      throw badRequest("splitAmong must be an array of user ids");
    }
    splitAmong = body.splitAmong as string[];
  }
  const expense = createExpense(db, group, user.id, {
    amountCents: requireCents(body, "amountCents"),
    currency: requireCurrency(body, "currency"),
    description: requireString(body, "description", 200),
    spentOn: requireDate(body, "spentOn"),
    splitAmong,
  });
  return { status: 201, body: expense };
});

route("GET", "/groups/:groupId/expenses", ({ db, user, params, query }) => {
  const group = requireMemberGroup(db, parseId(params.groupId!, "group"), user.id);
  const from = query.get("from") ?? undefined;
  const to = query.get("to") ?? undefined;
  for (const [name, value] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (value !== undefined && !isIsoDate(value)) throw badRequest(`${name} must be YYYY-MM-DD`);
  }
  return { status: 200, body: { expenses: listExpenses(db, group.id, { from, to }) } };
});

route("DELETE", "/groups/:groupId/expenses/:expenseId", ({ db, user, params }) => {
  const group = requireMemberGroup(db, parseId(params.groupId!, "group"), user.id);
  deleteExpense(db, group, user.id, parseId(params.expenseId!, "expense"));
  return { status: 204 };
});

// ---- Balances and settlements --------------------------------------------

route("GET", "/groups/:groupId/balances", ({ db, user, params }) => {
  const group = requireMemberGroup(db, parseId(params.groupId!, "group"), user.id);
  return { status: 200, body: { currency: group.currency, balances: groupBalances(db, group.id) } };
});

route("POST", "/groups/:groupId/settlements", async ({ db, user, params, req }) => {
  const group = requireMemberGroup(db, parseId(params.groupId!, "group"), user.id);
  const body = await readJson(req);
  const toUserId = requireString(body, "toUserId", 64);
  const amountCents = requireCents(body, "amountCents");
  return { status: 201, body: recordSettlement(db, group, user.id, toUserId, amountCents) };
});

// ---- Dispatch -----------------------------------------------------------

export function createApp(db: Db) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const user = authenticate(db, req.headers.authorization);
      if (!user) throw new HttpError(401, "unauthorized", "Missing or invalid token");

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.pattern.exec(url.pathname);
        if (!match) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(match[i + 1]!)]));
        const reply = await r.handler({ db, user, params, query: url.searchParams, req });
        sendJson(res, reply.status, reply.body);
        return;
      }
      throw notFound("No such route");
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.code, message: err.message });
      } else {
        console.error(err);
        sendJson(res, 500, { error: "internal", message: "Internal error" });
      }
    }
  };
}
