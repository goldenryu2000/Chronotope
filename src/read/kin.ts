import type { BBox } from '../lib/bbox'

/**
 * One atlas in the tree of them: a rectangle of the world with packs laid over
 * it, and the plates drawn inside it.
 *
 * `entryPack` is which pack a link into it should open on, resolved on the
 * server rather than guessed by the caller: a link into a plate that offers no
 * published pack is a link to a 404, and which packs a plate offers is a
 * question only the database can answer. A plate with none yields no node at
 * all, which is the rule `publishedAtlases` already applies to what the landing
 * page will link.
 */
export interface Plate {
  slug: string
  title: string
  subtitle: string
  /** [west, south, east, north], the plate's edges. */
  bbox: BBox
  /** Where a link into this plate should land, as a pack slug. */
  entryPack: string
  /** Packs it offers, so a caller can keep the reader's own pack if it is here. */
  packs: string[]
  /** Plates drawn inside this one. Recursive, and usually empty. */
  children: Plate[]
}

/** The plate with this slug, anywhere in the tree. */
export function findPlate(tree: readonly Plate[], slug: string): Plate | null {
  for (const plate of tree) {
    if (plate.slug === slug) return plate
    const found = findPlate(plate.children, slug)
    if (found) return found
  }
  return null
}

/** The plate this one is drawn inside, or null for a root atlas. */
export function parentOfPlate(tree: readonly Plate[], slug: string): Plate | null {
  for (const plate of tree) {
    if (plate.children.some((child) => child.slug === slug)) return plate
    const found = parentOfPlate(plate.children, slug)
    if (found) return found
  }
  return null
}

/** The plates drawn inside this one, which is how a reader goes deeper. */
export function childrenOfPlate(tree: readonly Plate[], slug: string): Plate[] {
  return findPlate(tree, slug)?.children ?? []
}

/** Every plate, in reading order, with how deep it sits. For a list. */
export function flattenPlates(
  tree: readonly Plate[], depth = 0,
): { plate: Plate; depth: number }[] {
  return tree.flatMap((plate) => [
    { plate, depth },
    ...flattenPlates(plate.children, depth + 1),
  ])
}

/**
 * Which pack a link into `plate` should open on, keeping the reader's own
 * where it can.
 *
 * Changing plate is a change of scale, not a change of subject: a reader three
 * centuries into the gods does not want to arrive in philosophy because that
 * is what the destination happens to list first. When the plate does not offer
 * their pack, its own first is the honest fallback.
 */
export function entryPackFor(plate: Plate, currentPack: string): string {
  return plate.packs.includes(currentPack) ? currentPack : plate.entryPack
}

/** Where a link into `plate` goes, keeping the reader's pack where it can. */
export function plateHref(plate: Plate, currentPack: string): string {
  return `/${plate.slug}/${entryPackFor(plate, currentPack)}`
}
