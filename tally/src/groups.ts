import type { Db } from "./db.ts";
import { transaction } from "./db.ts";
import { badRequest, forbidden, HttpError, notFound } from "./http.ts";

export interface Group {
  id: number;
  name: string;
  currency: string;
  ownerId: string;
  createdAt: string;
}

export interface Member {
  userId: string;
  name: string;
}

interface GroupRow {
  id: number;
  name: string;
  currency: string;
  owner_id: string;
  created_at: string;
}

const toGroup = (r: GroupRow): Group => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
  ownerId: r.owner_id,
  createdAt: r.created_at,
});

export function createGroup(db: Db, ownerId: string, name: string, currency: string): Group {
  return transaction(db, () => {
    const result = db
      .prepare("INSERT INTO groups (name, currency, owner_id, created_at) VALUES (?, ?, ?, ?)")
      .run(name, currency, ownerId, new Date().toISOString());
    const groupId = Number(result.lastInsertRowid);
    db.prepare("INSERT INTO memberships (group_id, user_id) VALUES (?, ?)").run(groupId, ownerId);
    return getGroup(db, groupId)!;
  });
}

export function getGroup(db: Db, groupId: number): Group | null {
  const row = db.prepare("SELECT * FROM groups WHERE id = ?").get(groupId) as GroupRow | undefined;
  return row ? toGroup(row) : null;
}

export function isMember(db: Db, groupId: number, userId: string): boolean {
  return (
    db.prepare("SELECT 1 FROM memberships WHERE group_id = ? AND user_id = ?").get(groupId, userId) !==
    undefined
  );
}

/**
 * Loads a group the caller belongs to. Non-members get 404, not 403,
 * so that group ids can't be probed.
 */
export function requireMemberGroup(db: Db, groupId: number, userId: string): Group {
  const group = getGroup(db, groupId);
  if (!group || !isMember(db, groupId, userId)) throw notFound("Group not found");
  return group;
}

/** Members in join order (earliest first). */
export function listMembers(db: Db, groupId: number): Member[] {
  return db
    .prepare(
      `SELECT m.user_id AS userId, u.name AS name
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.group_id = ?
        ORDER BY m.id`,
    )
    .all(groupId) as unknown as Member[];
}

export function addMember(db: Db, group: Group, actorId: string, userId: string): Member[] {
  if (group.ownerId !== actorId) throw forbidden("Only the group owner can add members");
  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!user) throw badRequest("Unknown user");
  if (isMember(db, group.id, userId)) throw new HttpError(409, "conflict", "Already a member");
  db.prepare("INSERT INTO memberships (group_id, user_id) VALUES (?, ?)").run(group.id, userId);
  return listMembers(db, group.id);
}
