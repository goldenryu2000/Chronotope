import { describe, expect, it } from 'vitest'
import {
  activeAt,
  FADE_YEARS,
  isActive,
  midSpan,
  nearestInTime,
  openingYear,
  presence,
  withActiveSpan,
  type ActiveEntity,
} from './entitySpan'
import type { Entity } from './schemas'

const entity = (id: string, start: number, end: number): Entity => ({
  id,
  name: id,
  start,
  end,
  lat: 0,
  lng: 0,
  place: 'somewhere',
  traditions: ['a-tradition'],
  tier: 'core',
  blurb: 'x'.repeat(25),
  ideas: [],
  wikipedia: 'https://en.wikipedia.org/wiki/X',
  wikidata: 'Q1',
})

describe('withActiveSpan', () => {
  it('delays the pin by the offset, so a newborn is not on the map', () => {
    // Aristotle: 384 BCE to 322 BCE, philosophy's offset of 20.
    expect(withActiveSpan(entity('aristotle', -384, -322), 20).from).toBe(-364)
  })

  it('leaves the span alone when it is shorter than the offset', () => {
    // Otherwise the offset would push `from` past `to` and the entity would
    // never appear at all.
    const span = withActiveSpan(entity('brief', -300, -290), 20)
    expect(span.from).toBe(-300)
    expect(span.to).toBe(-290)
  })

  it('applies no offset for packs whose spans already mean attested', () => {
    expect(withActiveSpan(entity('zeus', -1400, 400), 0).from).toBe(-1400)
  })
})

describe('presence', () => {
  it('is full through the middle of a span', () => {
    expect(presence(withActiveSpan(entity('a', -400, -300), 0), -350)).toBe(1)
  })

  it('fades in over FADE_YEARS at each edge', () => {
    const span = withActiveSpan(entity('a', -400, -300), 0)
    expect(presence(span, -400)).toBe(0)
    expect(presence(span, -400 + FADE_YEARS)).toBe(1)
    expect(presence(span, -300)).toBe(0)
  })

  it('is zero outside the span entirely', () => {
    expect(presence(withActiveSpan(entity('a', -400, -300), 0), -500)).toBe(0)
  })
})

describe('activeAt', () => {
  it('keeps only the entities the offset span covers', () => {
    const entities = [
      withActiveSpan(entity('early', -600, -550), 20),
      withActiveSpan(entity('now', -400, -300), 20),
    ]
    expect(activeAt(entities, -350).map((e) => e.id)).toEqual(['now'])
    expect(isActive(entities[1], -390)).toBe(false)
  })
})

describe('nearestInTime', () => {
  const entities = [
    withActiveSpan(entity('early', -600, -550), 20),
    withActiveSpan(entity('late', -400, -300), 20),
  ]

  it('finds the closest entity on either side of an empty year', () => {
    expect(nearestInTime(entities, -520)?.id).toBe('early')
    expect(nearestInTime(entities, -420)?.id).toBe('late')
  })

  it('measures the gap against the offset span, not the raw one', () => {
    // `late` starts in -400 but is only on the map from -380. At -520 the gap
    // to `early` is 30 years and the gap to `late` is 140, not 120.
    expect(nearestInTime(entities, -520)?.id).toBe('early')
  })

  it('returns an entity already on the map at zero distance', () => {
    expect(nearestInTime(entities, -350)?.id).toBe('late')
  })

  it('has nothing to point at in an empty pack', () => {
    expect(nearestInTime([], -350)).toBeNull()
  })
})

describe('midSpan', () => {
  it('lands clear of both fade edges', () => {
    const span = withActiveSpan(entity('a', -400, -300), 20)
    const middle = midSpan(span)
    expect(middle).toBe(-340)
    expect(presence(span, middle)).toBe(1)
  })
})

describe('openingYear', () => {
  const span = (id: string, from: number, to: number) =>
    ({ id, from, to } as unknown as ActiveEntity)

  it('keeps the year asked for when somebody is there', () => {
    expect(openingYear([span('a', -400, -300)], -350)).toBe(-350)
  })

  it('opens where the empty state would have sent the reader', () => {
    // Philosophy opens in 350 BCE, which on India's plate is a century after
    // the Buddha and four before Nagarjuna. An atlas that opens empty spends
    // its first impression asking to be rescued.
    const buddha = span('buddha', -543, -483)
    expect(openingYear([buddha], -350)).toBe(-513)
  })

  it('prefers the nearest figure in time, not the first in the list', () => {
    const early = span('early', -900, -800)
    const late = span('late', -400, -300)
    expect(openingYear([early, late], -350)).toBe(-350)
    expect(openingYear([early, late], -1200)).toBe(-850)
  })

  it('leaves the year alone when the plate holds nobody at all', () => {
    // There is no year that helps, and moving the timeline would say there is.
    expect(openingYear([], -350)).toBe(-350)
  })
})
