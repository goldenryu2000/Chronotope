import { describe, expect, it } from 'vitest'
import { borderFilter, mappedYear } from './borderFilter'

describe('borderFilter', () => {
  it('includes a polity whose interval contains the year', () => {
    expect(borderFilter(1600)).toEqual([
      'all',
      ['<=', ['get', 'valid_from'], 1600],
      ['>', ['get', 'valid_to'], 1600],
    ])
  })

  it('is end-exclusive, matching int4range', () => {
    // A row valid [1600,1650) covers 1649 and not 1650. The filter must agree
    // with the database that produced it, so the upper test is `>` and never
    // `>=`. Whole-filter equality rather than `filter[2]`: `FilterSpecification`
    // is a union of tuple shapes and TypeScript will not index into it.
    expect(borderFilter(1650)).toEqual([
      'all',
      ['<=', ['get', 'valid_from'], 1650],
      ['>', ['get', 'valid_to'], 1650],
    ])
  })

  it('handles BCE years, which are plain negative integers', () => {
    expect(borderFilter(-500)).toEqual([
      'all',
      ['<=', ['get', 'valid_from'], -500],
      ['>', ['get', 'valid_to'], -500],
    ])
  })
})

describe('mappedYear', () => {
  // The upstream corpus draws -3000 to 2010. The timeline runs to 2026,
  // because people were still thinking after 2010.
  const YEARS = { first: -3000, last: 2010 }

  it('leaves a year the corpus drew alone', () => {
    expect(mappedYear(1600, YEARS)).toBe(1600)
  })

  it('shows the last mapped year for anything after it', () => {
    // The previous build did this by picking the nearest snapshot file. The
    // filter is exact, so without a clamp 2011 through 2026 draw no borders
    // at all — a blank map, which reads as a bug rather than as an absence.
    expect(mappedYear(2021, YEARS)).toBe(2010)
  })

  it('shows the first mapped year for anything before it', () => {
    expect(mappedYear(-3500, YEARS)).toBe(-3000)
  })

  it('keeps the endpoints themselves', () => {
    expect(mappedYear(2010, YEARS)).toBe(2010)
    expect(mappedYear(-3000, YEARS)).toBe(-3000)
  })

  it('is the identity when the region publishes no coverage', () => {
    // A region whose boundaries have not been imported yet has nothing to
    // clamp to. Guessing a range would draw the wrong century confidently.
    expect(mappedYear(2021, undefined)).toBe(2021)
  })
})
