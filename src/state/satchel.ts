/**
 * The satchel: one book and one record, carried with both hands free. A queue
 * rather than two named slots because one key works it — what went in first
 * comes out first, so with both stowed the same key reaches either, instead of
 * looping on whichever slot a fixed preference would hand back.
 */

export type SatchelItem = { kind: 'book' | 'record'; id: string }

export type SatchelPress = {
  satchel: SatchelItem[]
  /** What ended up in your hand: the front of the bag, or a same-kind swap. */
  taken: SatchelItem | null
  /** False only for an empty bag and an empty hand — the one dead press. */
  moved: boolean
}

/** One press of `I`: stow what is in the hand, or take the front item out. */
export function pressSatchel(satchel: SatchelItem[], hand: SatchelItem | null): SatchelPress {
  if (hand !== null) {
    // In it goes, to the back. The bag holds one of each kind, so a same-kind
    // item already in there comes out in exchange rather than refusing.
    const kept = satchel.filter((item) => item.kind !== hand.kind)
    const swapped = satchel.find((item) => item.kind === hand.kind) ?? null
    return { satchel: [...kept, hand], taken: swapped, moved: true }
  }
  const [front, ...rest] = satchel
  if (!front) return { satchel, taken: null, moved: false }
  return { satchel: rest, taken: front, moved: true }
}
