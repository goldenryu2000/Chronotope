import { describe, expect, it } from 'vitest'
import type { Pack, Region } from '../data/schemas'
import { validateTour, validateView, type ViewContext } from './validateView'

const entity = {
  id: 'aristotle', name: 'Aristotle', start: -384, end: -322,
  lat: 39.0, lng: 23.5, place: 'Stagira', traditions: ['greek'], tier: 'core' as const,
  blurb: 'A student of Plato who disagreed with him about nearly everything.',
  ideas: [], wikipedia: 'https://en.wikipedia.org/wiki/Aristotle', wikidata: 'Q868',
}

const pack = {
  id: 'philosophy', title: 'Philosophy', subtitle: 'Ideas', spanLabel: 'lived',
  activeOffset: 20, range: { start: -800, end: 2000 }, startYear: -350,
  traditions: [{ id: 'greek', label: 'Greek', regionLabel: 'Aegean' }],
  entities: [entity], eraOverrides: {},
} as unknown as Pack

const region = {
  id: 'world', range: { start: -3000, end: 2026 }, eras: [],
  // Rule 8 reads this: a plate draws the figures who stand on it. The world's
  // bbox is the world, so every rule below behaves as it did before rule 8
  // existed, which is the point.
  bbox: [-180, -85, 180, 85],
} as unknown as Region

/** A plate the size of a subcontinent, for the rules the world cannot exercise. */
const plate = {
  id: 'india', range: { start: -3000, end: 2026 }, eras: [],
  bbox: [66, 5, 97.6, 37.6],
} as unknown as Region

const ctx: ViewContext = { region, pack, layers: new Map() }

/**
 * The Silk Road's shape, near enough. The real `data/layers/silk-road.json`
 * spans 28.9 to 108.9 east and 33.3 to 42.9 north; this reaches a little
 * further south so the fixture is not accidentally exact.
 */
const silkRoad = {
  start: -130, end: 1450,
  bbox: [28.9, 31.0, 108.9, 42.9] as [number, number, number, number],
}

const layerCtx: ViewContext = { region, pack, layers: new Map([['silk-road', silkRoad]]) }

const view = {
  pack: 'philosophy', year: -350, entityId: 'aristotle',
  camera: { center: [23.5, 39.0] as [number, number], zoom: 5 }, layers: [],
}

describe('validateView', () => {
  it('passes a stop that frames its own pin inside a lifetime', () => {
    expect(validateView(view, ctx)).toEqual([])
  })

  it('rule 1: catches an entity in no pack', () => {
    const problems = validateView({ ...view, entityId: 'zoroaster' }, ctx)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ rule: 1, level: 'error' })
  })

  it('rule 2: catches a year outside the active span', () => {
    // Aristotle's span is -384..-322, and philosophy offsets by 20, so the map
    // shows him from -364. -300 is after his death: the ported build shipped
    // exactly this stop and it selected nobody.
    const problems = validateView({ ...view, year: -300 }, ctx)
    expect(problems.some((p) => p.rule === 2 && p.level === 'error')).toBe(true)
  })

  it('rule 2: warns near a fade edge without failing', () => {
    const problems = validateView({ ...view, year: -362 }, ctx)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ rule: 2, level: 'warning' })
  })

  it('rule 3: catches a camera framing an empty sea', () => {
    const far = { ...view, camera: { center: [103.9, 13.4] as [number, number], zoom: 5 } }
    expect(validateView(far, ctx).some((p) => p.rule === 3)).toBe(true)
  })

  it('rule 3: measures longitude the short way round', () => {
    const entityEast = { ...entity, id: 'kami', lng: 179, lat: 0 }
    const wrapped: ViewContext = {
      ...ctx,
      pack: { ...pack, entities: [entityEast], activeOffset: 0 } as Pack,
    }
    const near = {
      ...view, entityId: 'kami', year: -350,
      camera: { center: [-179, 0] as [number, number], zoom: 5 },
    }
    expect(validateView(near, wrapped).some((p) => p.rule === 3)).toBe(false)
  })

  it('rule 4: catches a year the region cannot reach', () => {
    const narrow = { ...ctx, region: { ...region, range: { start: -100, end: 2000 } } as Region }
    expect(validateView(view, narrow).some((p) => p.rule === 4)).toBe(true)
  })

  it('rule 5: catches a layer lit outside its own years', () => {
    const withLayer = { ...ctx, layers: new Map([['silk-road', silkRoad]]) }
    const lit = { ...view, layers: ['silk-road'] }
    expect(validateView(lit, withLayer).some((p) => p.rule === 5)).toBe(true)
  })

  it('rule 5: catches a layer slug that resolves to nothing', () => {
    expect(validateView({ ...view, layers: ['no-such-layer'] }, ctx).some((p) => p.rule === 5))
      .toBe(true)
  })

  it('judges a stop with nobody selected by its layers, not by rule 3', () => {
    // Once rule 7 exists, a stop about a place has to be about *some* place,
    // so this one lights the route it is looking at. What is still being
    // asserted is that rule 3 does not measure a camera against a pin that
    // was never selected.
    const placeStop = {
      ...view, year: 800, entityId: null, layers: ['silk-road'],
      camera: { center: [66.9, 39.6] as [number, number], zoom: 3 },
    }
    expect(validateView(placeStop, layerCtx)).toEqual([])
  })
})

describe('rule 7: a stop with no entity frames its layers', () => {
  /** A layer-led stop: no entity, so rule 3 does not look at it. */
  const led = {
    pack: 'philosophy', year: 800, entityId: null,
    camera: { center: [66.9, 39.6] as [number, number], zoom: 4 },
    layers: ['silk-road'],
  }

  it('accepts a camera over the route', () => {
    expect(validateView(led, layerCtx).filter((p) => p.rule === 7)).toHaveLength(0)
  })

  it('refuses a camera nowhere near it', () => {
    const away = { ...led, camera: { center: [-60, -20] as [number, number], zoom: 4 } }
    const [problem] = validateView(away, layerCtx).filter((p) => p.rule === 7)
    expect(problem.level).toBe('error')
    expect(problem.message).toMatch(/silk-road/)
  })

  it('leaves a stop with an entity to rule 3', () => {
    // Aristotle is on the map at -350, not 800, so the year moves too. What is
    // being asserted is only that rule 7 stays out of it.
    const withPin = { ...led, year: -350, entityId: 'aristotle', camera: { center: [23.5, 39.0] as [number, number], zoom: 5 } }
    expect(validateView(withPin, layerCtx).filter((p) => p.rule === 7)).toHaveLength(0)
  })

  it('accepts a layer-led stop that leaves the camera alone', () => {
    expect(validateView({ ...led, camera: null }, layerCtx).filter((p) => p.rule === 7))
      .toHaveLength(0)
  })

  it('refuses a stop that is about nothing at all', () => {
    const empty = { ...led, camera: null, layers: [] }
    const [problem] = validateView(empty, layerCtx).filter((p) => p.rule === 7)
    expect(problem.level).toBe('error')
    expect(problem.message).toMatch(/neither/)
  })

  it('leaves an unknown slug to rule 5 rather than naming it twice', () => {
    const unknown = { ...led, layers: ['no-such-layer'] }
    const problems = validateView(unknown, layerCtx)
    expect(problems.filter((p) => p.rule === 5)).toHaveLength(1)
    expect(problems.filter((p) => p.rule === 7)).toHaveLength(0)
  })
})

describe('rule 8: what a plate can actually draw', () => {
  it('refuses a stop selecting someone the plate has no pin for', () => {
    // Aristotle is at 23.5E: on the world map, and nowhere near India's plate.
    const problems = validateView(view, { ...ctx, region: plate })
    expect(problems.some((p) => p.rule === 8 && p.level === 'error')).toBe(true)
    expect(problems.find((p) => p.rule === 8)?.message).toContain('aristotle')
  })

  it('refuses a stop whose camera the plate will not let the reader reach', () => {
    const inside = { ...entity, id: 'nagarjuna', lng: 79.0, lat: 16.5 }
    const indianPack = { ...pack, entities: [inside] } as unknown as Pack
    const problems = validateView(
      { ...view, entityId: 'nagarjuna', camera: { center: [79.0, 16.5], zoom: 5 } },
      { region: plate, pack: indianPack, layers: new Map() },
    )
    expect(problems).toEqual([])

    // 12E is in the Mediterranean: MapLibre would clamp the move and the
    // reader would land somewhere the author never chose.
    const away = validateView(
      { ...view, entityId: 'nagarjuna', camera: { center: [12.0, 16.5], zoom: 5 } },
      { region: plate, pack: indianPack, layers: new Map() },
    )
    expect(away.some((p) => p.rule === 8 && p.level === 'error')).toBe(true)
  })

  it('allows a camera just past the plate edge, within the padding the map allows', () => {
    // India's bbox stops at 97.6E and `CAMERA_PAD` widens it by a tenth of the
    // plate, so about 100.8E is still reachable. A rule stricter than the map
    // would refuse stops that work.
    const edge = { ...entity, id: 'nagarjuna', lng: 97.0, lat: 26.0 }
    const indianPack = { ...pack, entities: [edge] } as unknown as Pack
    const problems = validateView(
      { ...view, entityId: 'nagarjuna', camera: { center: [99.5, 26.0], zoom: 5 } },
      { region: plate, pack: indianPack, layers: new Map() },
    )
    expect(problems.filter((p) => p.rule === 8)).toEqual([])
  })

  it('leaves every world stop alone', () => {
    expect(validateView(view, ctx).filter((p) => p.rule === 8)).toEqual([])
  })
})

describe('validateTour', () => {
  const tour = {
    id: 't', regionSlug: 'world', title: 'T', subtitle: 'S',
    description: 'A description long enough to satisfy the schema minimum.',
    estimatedMinutes: 5,
    stops: [{ ...view, title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30) }],
  }
  const tourCtx = { region, packs: new Map([['philosophy', pack]]), layers: new Map() }

  it('passes a sound tour', () => {
    expect(validateTour(tour, tourCtx)).toEqual([])
  })

  it('names the stop that is wrong', () => {
    const broken = { ...tour, stops: [{ ...tour.stops[0], entityId: 'nobody' }] }
    expect(validateTour(broken, tourCtx)[0].message).toContain('stop 1')
  })

  it('reports a stop naming a pack that is not loaded', () => {
    const broken = { ...tour, stops: [{ ...tour.stops[0], pack: 'creatures' }] }
    expect(validateTour(broken, tourCtx)).toHaveLength(1)
  })
})
