import type { Db } from "./db.ts";
import { listMembers } from "./groups.ts";

export interface Balance {
  userId: string;
  name: string;
  /**
   * Positive: the group owes this member money.
   * Negative: this member owes the group money.
   */
  balanceCents: number;
}

/**
 * Net balance per member:
 *   + what they paid for expenses
 *   - their share of every expense
 *   + settlements they paid to someone
 *   - settlements they received
 * Balances across a group always add up to zero.
 */
export function groupBalances(db: Db, groupId: number): Balance[] {
  const members = listMembers(db, groupId);
  const net = new Map<string, number>(members.map((m) => [m.userId, 0]));
  const add = (userId: string, cents: number) => net.set(userId, (net.get(userId) ?? 0) + cents);

  const paid = db
    .prepare("SELECT payer_id, SUM(amount_cents) AS total FROM expenses WHERE group_id = ? GROUP BY payer_id")
    .all(groupId) as { payer_id: string; total: number }[];
  for (const p of paid) add(p.payer_id, p.total);

  const owed = db
    .prepare(
      `SELECT s.user_id, SUM(s.share_cents) AS total
         FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
        WHERE e.group_id = ?
        GROUP BY s.user_id`,
    )
    .all(groupId) as { user_id: string; total: number }[];
  for (const o of owed) add(o.user_id, -o.total);

  const settlements = db
    .prepare("SELECT from_user, to_user, amount_cents FROM settlements WHERE group_id = ?")
    .all(groupId) as { from_user: string; to_user: string; amount_cents: number }[];
  for (const s of settlements) {
    add(s.from_user, -s.amount_cents);
    add(s.to_user, s.amount_cents);
  }

  return members.map((m) => ({ userId: m.userId, name: m.name, balanceCents: net.get(m.userId) ?? 0 }));
}
