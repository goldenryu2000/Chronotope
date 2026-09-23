import { describe, expect, it } from 'vitest'
import { resolveEras, resolveRange } from './resolveEras'

const era = (id: string, start: number, end: number) => ({
  id, label: id, start, end, weight: 1, blurb: 'x'.repeat(25),
})

// Artifacts identify a region by `id`, matching RegionSchema. The database
// column is `slug`; renderRegion maps one to the other. Do not mix them.
const region = {
  id: 'india',
  range: { start: -3000, end: 2027 },
  eras: [era('vedic', -1500, -500), era('mauryan', -321, -185)],
}
const pack = {
  id: 'philosophy',
  range: { start: -800, end: 2026 },
  eraOverrides: { world: [era('axial', -800, -300)] },
}

describe('resolveEras', () => {
  it('falls back to the region default when the pack has no override', () => {
    expect(resolveEras(region, pack).map((e) => e.id)).toEqual(['vedic', 'mauryan'])
  })

  it('prefers the pack override for that region', () => {
    const world = { ...region, id: 'world' }
    expect(resolveEras(world, pack).map((e) => e.id)).toEqual(['axial'])
  })

  it('is keyed by region, so an override elsewhere does not leak', () => {
    const japan = { ...region, id: 'japan' }
    expect(resolveEras(japan, pack).map((e) => e.id)).toEqual(['vedic', 'mauryan'])
  })

  it('treats an empty override as no override', () => {
    // `era_sets` says both "this pack is laid over this region" and "it
    // reshapes that region's time" with one row, and a plate that offers a
    // pack on its own periodization writes the first without the second.
    // Without this the region's own eras are replaced by nothing, which reaches
    // `buildScale([])` and throws in the reader's browser rather than here.
    const placed = { ...pack, eraOverrides: { india: [] } }
    expect(resolveEras(region, placed).map((e) => e.id)).toEqual(['vedic', 'mauryan'])
  })
})

describe('resolveRange', () => {
  it('narrows to the intersection — the pack never widens the region', () => {
    expect(resolveRange(region, pack)).toEqual({ start: -800, end: 2026 })
  })

  it('clamps a pack that reaches past the region', () => {
    const narrow = { ...region, range: { start: -1000, end: 1500 } }
    expect(resolveRange(narrow, pack)).toEqual({ start: -800, end: 1500 })
  })
})
