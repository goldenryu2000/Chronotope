import type { FilterSpecification } from 'maplibre-gl'

/**
 * Which polities are on the map in a given year.
 *
 * End-exclusive, matching the `int4range` the rows came from: a boundary valid
 * [1600,1650) covers 1649 and not 1650. Years are plain signed integers, so
 * this works unchanged for BCE.
 *
 * This is why a year change is a repaint rather than a fetch — every era is
 * already in the archive, and the map only has to be told which one to draw.
 */
export function borderFilter(year: number): FilterSpecification {
  return [
    'all',
    ['<=', ['get', 'valid_from'], year],
    ['>', ['get', 'valid_to'], year],
  ] as FilterSpecification
}

/**
 * The years a region's archive actually draws. `last` is inclusive.
 *
 * Measured from the boundary rows at publish time rather than assumed from the
 * region's `range`: the timeline runs to 2026 because people were still
 * thinking after 2010, and the upstream corpus stops at 2010.
 */
export interface BorderYears {
  first: number
  last: number
}

/**
 * The year to draw borders for, given the year the reader asked for.
 *
 * Outside the corpus there is no honest answer, only two dishonest ones: draw
 * nothing, or draw the nearest thing that exists. The previous build chose the
 * second by loading the nearest snapshot file, and it is the better lie — a
 * blank map reads as a broken map, and a reader scrubbing to 2021 is asking
 * where the philosopher stood, not whether the corpus has a 2021 sheet.
 *
 * Within the corpus this changes nothing: the intervals already answer every
 * year between two snapshots.
 *
 * Undefined coverage is the identity. A region whose boundaries have not been
 * imported has no range to clamp to, and inventing one would draw the wrong
 * century confidently.
 */
export function mappedYear(year: number, years: BorderYears | undefined): number {
  if (!years) return year
  return Math.min(years.last, Math.max(years.first, year))
}
