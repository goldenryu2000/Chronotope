import { describe, expect, it } from 'vitest'
import type { Era } from '../data/schemas'
import { buildScale } from './scale'

const era = (id: string, start: number, end: number, weight: number): Era => ({
  id,
  label: id,
  start,
  end,
  weight,
  blurb: 'x'.repeat(25),
})

/** A deliberately lopsided set: a long, heavily weighted era beside a short one. */
const ERAS: Era[] = [
  era('axial', -800, -300, 14),
  era('hellenistic', -300, 200, 12),
  era('modern', 200, 2026, 4),
]

describe('buildScale', () => {
  const scale = buildScale(ERAS)

  it('spans the full range from 0 to 1', () => {
    expect(scale.start).toBe(-800)
    expect(scale.end).toBe(2026)
    expect(scale.toPosition(-800)).toBe(0)
    expect(scale.toPosition(2026)).toBe(1)
  })

  it('clamps years outside the range', () => {
    expect(scale.toPosition(-5000)).toBe(0)
    expect(scale.toPosition(9999)).toBe(1)
    expect(scale.toYear(-1)).toBe(-800)
    expect(scale.toYear(2)).toBe(2026)
  })

  it('gives each era its weighted share of the track', () => {
    const total = 14 + 12 + 4
    expect(scale.toPosition(-300)).toBeCloseTo(14 / total, 10)
    expect(scale.toPosition(200)).toBeCloseTo((14 + 12) / total, 10)
  })

  it('round-trips year to position and back', () => {
    for (let year = -800; year <= 2026; year += 7) {
      expect(scale.toYear(scale.toPosition(year))).toBe(year)
    }
  })

  it('is monotonic', () => {
    let previous = -1
    for (let year = -800; year <= 2026; year += 13) {
      const position = scale.toPosition(year)
      expect(position).toBeGreaterThanOrEqual(previous)
      previous = position
    }
  })

  it('stretches dense eras relative to their length', () => {
    // The Axial Age is 500 years on 14/30 of the track; "modern" is 1,826 years
    // on 4/30. A single year should therefore occupy far more room in the
    // Axial Age — that is the entire point of weighting.
    const axialPerYear = scale.toPosition(-799) - scale.toPosition(-800)
    const modernPerYear = scale.toPosition(1001) - scale.toPosition(1000)
    expect(axialPerYear).toBeGreaterThan(modernPerYear * 5)
  })

  it('reports the era containing a year, with boundaries belonging to the later era', () => {
    expect(scale.eraAt(-800).id).toBe('axial')
    expect(scale.eraAt(-301).id).toBe('axial')
    expect(scale.eraAt(-300).id).toBe('hellenistic')
    expect(scale.eraAt(2026).id).toBe('modern')
  })
})

// Not in the ported reference: RegionSchema permits eras: [], so a region
// with no eras and no pack override can reach buildScale([]) — this guards
// that path with a clear error instead of an undefined-property crash.
describe('buildScale with no eras', () => {
  it('throws a clear, actionable error instead of crashing on placed[0]', () => {
    expect(() => buildScale([])).toThrow(/era set/)
  })
})
