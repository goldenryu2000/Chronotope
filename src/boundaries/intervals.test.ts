import { describe, expect, it } from 'vitest'
import { foldIntervals } from './intervals'

// The snapshot years this project actually has, abbreviated for readability.
const YEARS = [1500, 1600, 1650, 1700, 1800, 1900]

describe('foldIntervals', () => {
  it('merges consecutive snapshots with the same shape', () => {
    const observations = [
      { year: 1600, shapeKey: 'a' },
      { year: 1650, shapeKey: 'a' },
      { year: 1700, shapeKey: 'a' },
    ]
    expect(foldIntervals(observations, YEARS)).toEqual([
      { from: 1600, to: 1800, shapeKey: 'a' },
    ])
  })

  it('closes an interval at the snapshot where the shape changes', () => {
    const observations = [
      { year: 1600, shapeKey: 'a' },
      { year: 1650, shapeKey: 'b' },
    ]
    expect(foldIntervals(observations, YEARS)).toEqual([
      { from: 1600, to: 1650, shapeKey: 'a' },
      { from: 1650, to: 1700, shapeKey: 'b' },
    ])
  })

  it('does not bridge a gap where the polity is absent', () => {
    // Present at 1500 and 1700, absent at 1600 and 1650. That is two
    // intervals, not one — a polity that disappears and returns did not
    // quietly persist in between, and int4range cannot hold a hole anyway.
    const observations = [
      { year: 1500, shapeKey: 'a' },
      { year: 1700, shapeKey: 'a' },
    ]
    expect(foldIntervals(observations, YEARS)).toEqual([
      { from: 1500, to: 1600, shapeKey: 'a' },
      { from: 1700, to: 1800, shapeKey: 'a' },
    ])
  })

  it('closes the final snapshot at the following year, not at infinity', () => {
    // The data says the polity was there in 1900. It does not say it is there
    // now, and pretending otherwise would assert something the snapshots
    // cannot support.
    const observations = [{ year: 1900, shapeKey: 'a' }]
    expect(foldIntervals(observations, YEARS)).toEqual([
      { from: 1900, to: 1901, shapeKey: 'a' },
    ])
  })

  it('never emits an empty interval', () => {
    const observations = [{ year: 1500, shapeKey: 'a' }]
    const intervals = foldIntervals(observations, YEARS)
    for (const interval of intervals) expect(interval.to).toBeGreaterThan(interval.from)
  })

  it('returns nothing for no observations', () => {
    expect(foldIntervals([], YEARS)).toEqual([])
  })

  it('crosses the BCE/CE boundary without a year 0 to stumble on', () => {
    // The real snapshot years jump straight from -1 to 100 — there is no year
    // 0. nextYear must follow the snapshot list's actual neighbours, not
    // arithmetic on the year number, or a shape spanning this gap would get
    // the wrong close year.
    const bceYears = [-100, -1, 100, 200]
    const observations = [
      { year: -100, shapeKey: 'a' },
      { year: -1, shapeKey: 'a' },
    ]
    expect(foldIntervals(observations, bceYears)).toEqual([
      { from: -100, to: 100, shapeKey: 'a' },
    ])
  })

  it('does not depend on the order observations are supplied in', () => {
    // Folding sorts internally, so a caller handing observations back in
    // whatever order they came out of a query (or a shuffled fixture) must
    // fold identically to the sorted case.
    const observations = [
      { year: 1700, shapeKey: 'a' },
      { year: 1600, shapeKey: 'a' },
      { year: 1650, shapeKey: 'a' },
    ]
    expect(foldIntervals(observations, YEARS)).toEqual([
      { from: 1600, to: 1800, shapeKey: 'a' },
    ])
  })
})
