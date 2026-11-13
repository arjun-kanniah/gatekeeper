/**
 * Splits an amount equally among members.
 *
 * memberIds must be in join order (earliest first).
 * Returns each member's share in cents.
 */
export function splitEqually(amountCents: number, memberIds: string[]): Map<string, number> {
  if (memberIds.length === 0) throw new Error("Cannot split among zero members");
  const each = Math.round(amountCents / memberIds.length);
  return new Map(memberIds.map((id) => [id, each]));
}
