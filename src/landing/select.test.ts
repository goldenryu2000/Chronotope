import { describe, expect, it } from 'vitest'
import type { Portrait } from '../read/landingPortraits'
import { othersCount, pinsForYear, platePosition, portraitStrip, startPack } from './select'

let n = 0
const p = (over: Partial<Portrait>): Portrait => {
  n += 1
  return {
    pack: 'a',
    slug: `e${n}`,
    name: `E${n}`,
    start: 0,
    end: 100,
    lng: 0,
    lat: 0,
    src: `/images/a/e${n}.jpg`,
    ...over,
  }
}

describe('pinsForYear', () => {
  it('keeps only figures whose span contains the year, inclusively', () => {
    const early = p({ start: -500, end: -400 })
    const edge = p({ start: -400, end: -300, lng: 60 })
    const late = p({ start: 100, end: 200, lng: 120 })
    const pins = pinsForYear([early, edge, late], -400)
    expect(pins.map((pin) => pin.slug).sort()).toEqual([early.slug, edge.slug].sort())
  })

  it('prefers a figure of that moment over one attested for ages', () => {
    const ancient = p({ start: -3000, end: 2000 })
    const person = p({ start: -470, end: -399 })
    expect(pinsForYear([ancient, person], -450, { count: 1 })[0].slug).toBe(person.slug)
  })

  it('does not stack pins on top of each other', () => {
    const athens = p({ lng: 23.7, lat: 38, start: -470, end: -399 })
    const nearby = p({ lng: 22, lat: 37, start: -420, end: -350 })
    const china = p({ lng: 117, lat: 35.6, start: -551, end: -300 })
    const pins = pinsForYear([athens, nearby, china], -400)
    expect(pins).toHaveLength(2)
    expect(pins.map((pin) => pin.slug)).toContain(china.slug)
  })

  it('rotates across packs rather than filling up from one', () => {
    const phil = [0, 60, 120].map((lng) => p({ pack: 'phil', lng, start: -10, end: 10 }))
    const myth = p({ pack: 'myth', lng: -100, start: -500, end: 500 })
    const pins = pinsForYear([...phil, myth], 0, { count: 2 })
    expect(new Set(pins.map((pin) => pin.pack))).toEqual(new Set(['phil', 'myth']))
  })

  it('caps the count and is deterministic', () => {
    const many = Array.from({ length: 10 }, (_, i) => p({ lng: -170 + i * 36, start: -10, end: 10 }))
    const first = pinsForYear(many, 0, { count: 4 })
    expect(first).toHaveLength(4)
    expect(pinsForYear([...many].reverse(), 0, { count: 4 })).toEqual(first)
  })
})

describe('portraitStrip', () => {
  it('spreads its picks across the timeline, first to last', () => {
    const list = [5, 1, 4, 2, 3, 6, 7].map((start) => p({ start: start * 100, end: start * 100 + 50 }))
    const strip = portraitStrip(list, 4)
    expect(strip.map((item) => item.start)).toEqual([100, 300, 500, 700])
  })

  it('returns everything when there are fewer than asked', () => {
    const list = [p({ start: 2 }), p({ start: 1 })]
    expect(portraitStrip(list, 4).map((item) => item.start)).toEqual([1, 2])
  })
})

describe('startPack', () => {
  const packs = [
    { slug: 'creatures', title: 'Creatures', entityCount: 59 },
    { slug: 'mythology', title: 'Mythology', entityCount: 160 },
    { slug: 'philosophy', title: 'Philosophy', entityCount: 81 },
  ]

  it('opens on the pack with the most portraits to show', () => {
    const portraits = [
      ...Array.from({ length: 3 }, () => p({ pack: 'philosophy' })),
      p({ pack: 'mythology' }),
    ]
    expect(startPack(packs, portraits)?.slug).toBe('philosophy')
  })

  it('falls back to the largest pack when nothing is pictured', () => {
    expect(startPack(packs, [])?.slug).toBe('mythology')
  })

  it('is undefined with no packs', () => {
    expect(startPack([], [])).toBeUndefined()
  })
})

describe('platePosition', () => {
  it('maps a place onto the plate as percentages', () => {
    const { left, top } = platePosition(0, 10)
    expect(left).toBeCloseTo(50)
    expect(top).toBeCloseTo(50)
  })

  it('keeps a pin off the very edge', () => {
    expect(platePosition(179.9, 77.9).left).toBeLessThan(100)
    expect(platePosition(-180, 78).left).toBeGreaterThan(0)
    expect(platePosition(-180, 78).top).toBeGreaterThan(0)
  })
})

describe('othersCount', () => {
  it('counts the figures a card does not name', () => {
    expect(othersCount(81, 3)).toBe(78)
    expect(othersCount(2, 3)).toBe(0)
  })
})
