export type Ranked = { id: number; rank: number };

/**
 * `siblings` is the destination column, moving card excluded, rank ascending.
 * `insertAt` is the slot the card should occupy, from 0 through siblings.length.
 * A gap under 2 cannot hold an integer, so the column is renumbered around the slot.
 */
export function planInsert(
  siblings: Ranked[],
  insertAt: number,
): { rank: number; renumber: Ranked[] | null } {
  if (!Number.isInteger(insertAt) || insertAt < 0 || insertAt > siblings.length) {
    throw new Error('insertAt out of range');
  }
  const before = insertAt > 0 ? siblings[insertAt - 1] : undefined;
  const after = insertAt < siblings.length ? siblings[insertAt] : undefined;
  if (before && after) {
    const gap = after.rank - before.rank;
    if (gap >= 2) return { rank: before.rank + Math.floor(gap / 2), renumber: null };
  } else if (!before && after) {
    if (after.rank >= 2) return { rank: Math.floor(after.rank / 2), renumber: null };
  } else if (before && !after) {
    return { rank: before.rank + 1024, renumber: null };
  } else {
    return { rank: 1024, renumber: null };
  }
  const slots: Array<number | null> = siblings.map((item) => item.id);
  slots.splice(insertAt, 0, null);
  const renumber: Ranked[] = [];
  let rank = 0;
  slots.forEach((id, index) => {
    const value = (index + 1) * 1024;
    if (id == null) rank = value;
    else renumber.push({ id, rank: value });
  });
  return { rank, renumber };
}
