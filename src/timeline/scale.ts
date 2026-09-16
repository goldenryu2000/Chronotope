import type { Era } from '../data/schemas'

/**
 * Maps years to positions along the timeline track, and back.
 *
 * A linear axis would be useless here. From 800 BCE to now is ~2,800 years, and
 * a third of the interesting material sits in the last two centuries; drawn to
 * scale the Axial Age is a handful of pixels while the twentieth century
 * sprawls. So each era declares a `weight` — its share of the track — and the
 * mapping is piecewise-linear between era boundaries.
 *
 * The result is that a year in 500 BCE and a year in 1950 occupy different
 * amounts of track, deliberately. Dense periods get room to be scrubbed through.
 */
export interface TimelineScale {
  readonly eras: readonly PlacedEra[]
  readonly start: number
  readonly end: number
  /** Year to a fraction of the track, 0 to 1. */
  toPosition: (year: number) => number
  /** A fraction of the track back to a year, rounded to a whole year. */
  toYear: (position: number) => number
  /** The era containing a year, clamped to the ends of the range. */
  eraAt: (year: number) => PlacedEra
}

export interface PlacedEra extends Era {
  /** Fraction of the track where this era begins. */
  offset: number
  /** Fraction of the track this era occupies. */
  span: number
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export function buildScale(eras: readonly Era[]): TimelineScale {
  // Deviation from the ported reference (PhilMap/src/timeline/scale.ts): that
  // build never called buildScale([]), so it never guarded against it. Here
  // RegionSchema permits eras: [], and a region with no eras and no pack
  // override would otherwise reach `placed[0].start` and crash on undefined
  // several calls away from this, the actual cause. Fail loudly here instead.
  if (eras.length === 0) {
    throw new Error(
      'buildScale requires at least one era: the timeline track is built from era weights, and an empty era set has no weights to divide it by.',
    )
  }

  const ordered = [...eras].sort((a, b) => a.start - b.start)
  const totalWeight = ordered.reduce((sum, era) => sum + era.weight, 0)

  let offset = 0
  const placed: PlacedEra[] = ordered.map((era) => {
    const span = era.weight / totalWeight
    const entry = { ...era, offset, span }
    offset += span
    return entry
  })

  const start = placed[0].start
  const end = placed[placed.length - 1].end

  const toPosition = (year: number): number => {
    if (year <= start) return 0
    if (year >= end) return 1

    const era = placed.find((candidate) => year < candidate.end) ?? placed[placed.length - 1]
    const within = (year - era.start) / (era.end - era.start)
    return clamp01(era.offset + within * era.span)
  }

  const toYear = (position: number): number => {
    const p = clamp01(position)
    if (p <= 0) return start
    if (p >= 1) return end

    const era = placed.find((candidate) => p < candidate.offset + candidate.span) ?? placed[0]
    const within = (p - era.offset) / era.span
    return Math.round(era.start + within * (era.end - era.start))
  }

  const eraAt = (year: number): PlacedEra => {
    if (year <= start) return placed[0]
    if (year >= end) return placed[placed.length - 1]
    return placed.find((candidate) => year < candidate.end) ?? placed[placed.length - 1]
  }

  return { eras: placed, start, end, toPosition, toYear, eraAt }
}
