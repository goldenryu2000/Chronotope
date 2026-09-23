import type { BBox } from '../lib/bbox'

/**
 * A neighbouring plate in the atlas: the one this is drawn inside, or one
 * drawn inside this.
 *
 * `entryPack` is which pack to open it on, resolved here rather than guessed
 * by the caller: a link into a plate that offers no published pack is a link
 * to a 404, and which packs a plate offers is a question only the database can
 * answer. A region with no published pack yields no row at all, which is the
 * same rule `publishedAtlases` applies to what the landing page will link.
 */
export interface RegionKin {
  slug: string
  title: string
  subtitle: string
  /** [west, south, east, north], the plate's edges. */
  bbox: BBox
  /** Where a link into this plate should land, as a pack slug. */
  entryPack: string
  /** Packs it offers, so a caller can keep the reader's own pack if it is here. */
  packs: string[]
}

/**
 * Which pack a link into `kin` should open on, keeping the reader's own where
 * it can.
 *
 * Going closer in is a change of scale, not a change of subject: a reader
 * three centuries into the gods does not want to arrive in philosophy because
 * that is what the destination happens to list first. When the plate does not
 * offer their pack, its own first is the honest fallback.
 */
export function entryPackFor(kinRegion: RegionKin, currentPack: string): string {
  return kinRegion.packs.includes(currentPack) ? currentPack : kinRegion.entryPack
}

/** Where a link into `kin` goes, keeping the reader's pack where it can. */
export function kinHref(kinRegion: RegionKin, currentPack: string): string {
  return `/${kinRegion.slug}/${entryPackFor(kinRegion, currentPack)}`
}
