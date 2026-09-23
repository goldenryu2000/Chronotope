import type { Era } from '../data/schemas'

interface EraSource {
  id: string
  range: { start: number; end: number }
  eras: readonly Era[]
}
interface EraOverrides {
  range: { start: number; end: number }
  eraOverrides: Record<string, readonly Era[]>
}

/**
 * Exactly one era set may drive the timeline, because era weights distort the
 * year↔position mapping — two competing sets cannot both be right. The region
 * supplies the default periodization; a pack overrides it only where it has an
 * editorial view of that region's shape of time.
 */
export function resolveEras(region: EraSource, pack: EraOverrides): readonly Era[] {
  // An empty override is not an override. `era_sets` records both "this pack
  // is laid over this region" and "it reshapes that region's time" in one row,
  // and a plate that offers a pack on its own periodization writes the first
  // without the second. `renderPack` omits the key for exactly that case; this
  // is the second half of the same guard, for an artifact published before it
  // did. Without both, such a pack reaches `buildScale([])` and the atlas
  // opens with no timeline at all.
  const override = pack.eraOverrides[region.id]
  return override && override.length > 0 ? override : region.eras
}

/** The region sets the outer bound; the pack narrows within it, never past it. */
export function resolveRange(region: EraSource, pack: EraOverrides) {
  return {
    start: Math.max(region.range.start, pack.range.start),
    end: Math.min(region.range.end, pack.range.end),
  }
}
