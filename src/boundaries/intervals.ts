/**
 * An observation of one polity's shape in one snapshot.
 *
 * `shapeKey` is an opaque identity, not geometry. Deciding whether two
 * geometries are "the same" is the importer's job and is deliberately not done
 * here — see the dedup note in scripts/import-boundaries.ts.
 */
export interface Observation {
  year: number
  shapeKey: string
}

/** A half-open validity interval, matching Postgres `int4range` [from, to). */
export interface Interval {
  from: number
  to: number
  shapeKey: string
}

/**
 * Fold per-snapshot observations into validity intervals.
 *
 * The endpoints are artifacts of snapshot spacing, not historical change
 * dates. If a polity looks the same at 1600 and 1650, we can honestly say it
 * held that shape across [1600, 1650). If it looks different, we know only
 * that it changed somewhere in between — so the interval closes at the next
 * snapshot, which is the most the data supports.
 *
 * A polity absent from an intervening snapshot gets two intervals rather than
 * one bridged interval. It did not quietly persist while the map said it was
 * gone, and `int4range` cannot represent a hole in any case.
 *
 * One year may carry several observations. 184 (name, year) pairs in the border
 * corpus do — a polity drawn as two or more separate features in one snapshot —
 * so this is not a hypothetical. Each starts its own interval over the same
 * span, which is the honest answer: they are distinct shapes, both attested for
 * that year. That falls out of only ever extending the *last* interval, so a
 * sibling at the same year can never be absorbed into the one before it; a
 * later snapshot may extend at most one of them, which can cost a row but
 * cannot merge two shapes. Load-bearing, and the reason the loop below does not
 * search back through `intervals` for a matching shape key.
 */
export function foldIntervals(
  observations: readonly Observation[],
  snapshotYears: readonly number[],
): Interval[] {
  if (observations.length === 0) return []

  const years = [...snapshotYears].sort((a, b) => a - b)
  const nextYear = (year: number): number => {
    const index = years.indexOf(year)
    // The last snapshot closes one year later: the data attests this year, and
    // nothing beyond it.
    return index >= 0 && index < years.length - 1 ? years[index + 1] : year + 1
  }

  const ordered = [...observations].sort((a, b) => a.year - b.year)
  const intervals: Interval[] = []

  for (const observation of ordered) {
    const open = intervals[intervals.length - 1]
    const continues =
      open !== undefined &&
      open.shapeKey === observation.shapeKey &&
      open.to === observation.year // contiguous: no snapshot skipped

    if (continues) {
      open.to = nextYear(observation.year)
    } else {
      intervals.push({
        from: observation.year,
        to: nextYear(observation.year),
        shapeKey: observation.shapeKey,
      })
    }
  }

  return intervals
}
