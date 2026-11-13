import type { Db } from "./db.ts";
import { transaction } from "./db.ts";
import type { Group } from "./groups.ts";
import { listMembers } from "./groups.ts";
import { badRequest, forbidden, notFound } from "./http.ts";
import { splitEqually } from "./split.ts";

export interface Share {
  userId: string;
  shareCents: number;
}

export interface Expense {
  id: number;
  groupId: number;
  payerId: string;
  amountCents: number;
  currency: string;
  description: string;
  spentOn: string;
  createdAt: string;
  shares: Share[];
}

export interface NewExpense {
  amountCents: number;
  currency: string;
  description: string;
  spentOn: string;
  /** Members to split among. Defaults to every member of the group. */
  splitAmong?: string[];
}

interface ExpenseRow {
  id: number;
  group_id: number;
  payer_id: string;
  amount_cents: number;
  currency: string;
  description: string;
  spent_on: string;
  created_at: string;
}

function loadShares(db: Db, expenseId: number): Share[] {
  return db
    .prepare(
      `SELECT s.user_id AS userId, s.share_cents AS shareCents
         FROM expense_shares s
         JOIN expenses e ON e.id = s.expense_id
         JOIN memberships m ON m.group_id = e.group_id AND m.user_id = s.user_id
        WHERE s.expense_id = ?
        ORDER BY m.id`,
    )
    .all(expenseId) as unknown as Share[];
}

const toExpense = (db: Db, r: ExpenseRow): Expense => ({
  id: r.id,
  groupId: r.group_id,
  payerId: r.payer_id,
  amountCents: r.amount_cents,
  currency: r.currency,
  description: r.description,
  spentOn: r.spent_on,
  createdAt: r.created_at,
  shares: loadShares(db, r.id),
});

export function createExpense(db: Db, group: Group, payerId: string, input: NewExpense): Expense {
  const members = listMembers(db, group.id).map((m) => m.userId);

  let participants = members;
  if (input.splitAmong !== undefined) {
    const requested = new Set(input.splitAmong);
    if (requested.size === 0) throw badRequest("splitAmong must not be empty");
    for (const id of requested) {
      if (!members.includes(id)) throw badRequest(`${id} is not a member of this group`);
    }
    participants = members.filter((id) => requested.has(id)); // keep join order
  }

  const shares = splitEqually(input.amountCents, participants);

  return transaction(db, () => {
    const result = db
      .prepare(
        `INSERT INTO expenses (group_id, payer_id, amount_cents, currency, description, spent_on, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        group.id,
        payerId,
        input.amountCents,
        input.currency,
        input.description,
        input.spentOn,
        new Date().toISOString(),
      );
    const expenseId = Number(result.lastInsertRowid);
    const insertShare = db.prepare(
      "INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (?, ?, ?)",
    );
    for (const [userId, cents] of shares) insertShare.run(expenseId, userId, cents);
    return getExpense(db, group.id, expenseId)!;
  });
}

export function getExpense(db: Db, groupId: number, expenseId: number): Expense | null {
  const row = db
    .prepare("SELECT * FROM expenses WHERE id = ? AND group_id = ?")
    .get(expenseId, groupId) as ExpenseRow | undefined;
  return row ? toExpense(db, row) : null;
}

export interface ExpenseFilter {
  /** Inclusive start date, YYYY-MM-DD. */
  from?: string;
  /** Inclusive end date, YYYY-MM-DD. */
  to?: string;
}

/** Lists a group's expenses, newest spending date first. Both range ends are inclusive. */
export function listExpenses(db: Db, groupId: number, filter: ExpenseFilter = {}): Expense[] {
  const clauses = ["group_id = ?"];
  const params: (string | number)[] = [groupId];
  if (filter.from) {
    clauses.push("spent_on >= ?");
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push("spent_on < ?");
    params.push(filter.to);
  }
  const rows = db
    .prepare(`SELECT * FROM expenses WHERE ${clauses.join(" AND ")} ORDER BY spent_on DESC, id DESC`)
    .all(...params) as unknown as ExpenseRow[];
  return rows.map((r) => toExpense(db, r));
}

/** The payer or the group owner may delete an expense. */
export function deleteExpense(db: Db, group: Group, actorId: string, expenseId: number): void {
  const expense = getExpense(db, group.id, expenseId);
  if (!expense) throw notFound("Expense not found");
  if (expense.payerId !== actorId && group.ownerId !== actorId) {
    throw forbidden("Only the payer or the group owner can delete this expense");
  }
  db.prepare("DELETE FROM expenses WHERE id = ?").run(expenseId);
}
