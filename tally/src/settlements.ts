import type { Db } from "./db.ts";
import type { Group } from "./groups.ts";
import { isMember } from "./groups.ts";
import { badRequest } from "./http.ts";

export interface Settlement {
  id: number;
  groupId: number;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  createdAt: string;
}

/** Records that `fromUserId` paid `toUserId` outside the app. */
export function recordSettlement(
  db: Db,
  group: Group,
  fromUserId: string,
  toUserId: string,
  amountCents: number,
): Settlement {
  if (fromUserId === toUserId) throw badRequest("Cannot settle with yourself");
  if (!isMember(db, group.id, toUserId)) throw badRequest(`${toUserId} is not a member of this group`);
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      "INSERT INTO settlements (group_id, from_user, to_user, amount_cents, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(group.id, fromUserId, toUserId, amountCents, createdAt);
  return {
    id: Number(result.lastInsertRowid),
    groupId: group.id,
    fromUserId,
    toUserId,
    amountCents,
    createdAt,
  };
}
