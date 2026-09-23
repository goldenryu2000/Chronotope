import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AtlasViewSchema, EntitySchema, EraSchema, isSlug, LayerSchema, RegionDefinitionSchema,
  RegionSchema, TourSchema,
} from './schemas'
import { LAYER_SLOTS } from '../theme/layerSlots'

const entity = {
  id: 'laozi',
  name: 'Laozi',
  start: -604,
  end: -500,
  lat: 30.423,
  lng: 112.173,
  place: 'State of Chu',
  traditions: ['daoism'],
  tier: 'core',
  blurb: 'Traditional author of the Daodejing, and possibly not a single person at all.',
  wikipedia: 'https://en.wikipedia.org/wiki/Laozi',
  wikidata: 'Q9333',
}

describe('EntitySchema', () => {
  it('accepts a well-formed entity', () => {
    expect(EntitySchema.parse(entity)).toMatchObject({ id: 'laozi' })
  })
  it('rejects an end before its start', () => {
    expect(() => EntitySchema.parse({ ...entity, end: -700 })).toThrow()
  })
  it('rejects a non-kebab id', () => {
    expect(() => EntitySchema.parse({ ...entity, id: 'Lao Zi' })).toThrow()
  })
})

describe('EraSchema', () => {
  it('requires a positive weight', () => {
    const era = {
      id: 'axial',
      label: 'The Axial Age',
      start: -800,
      end: -300,
      weight: 0,
      blurb: 'Greece, the Ganges plain, China and Persia each turned to how one ought to live.',
    }
    expect(() => EraSchema.parse(era)).toThrow()
  })
})

describe('RegionDefinitionSchema', () => {
  /** The India plate, near enough, as a starting point each case bends. */
  const base = {
    id: 'india',
    title: 'India',
    subtitle: 'the subcontinent, kingdom by kingdom',
    parent: 'world',
    bbox: [66, 5, 97.6, 37.6],
    minZoom: 3,
    maxZoom: 8,
    defaultCamera: { center: [80.5, 21.5], zoom: 3.8 },
    range: { start: -3000, end: 2026 },
    packs: ['philosophy'],
    eras: [
      {
        id: 'indus', label: 'The Indus Cities', start: -3000, end: -1500, weight: 7,
        blurb: 'Drains, standard weights and a script nobody can read, then the cities were left.',
      },
      {
        id: 'vedic', label: 'The Vedic Age', start: -1500, end: 2026, weight: 9,
        blurb: 'No cities, no inscriptions, and the longest continuously recited text there is.',
      },
    ],
  }

  it('accepts a plate drawn inside another', () => {
    const region = RegionDefinitionSchema.parse(base)
    expect(region.parent).toBe('world')
    expect(region.theme).toBe('rustic')
  })

  it('treats a bare pack slug as a placement with no era override', () => {
    // The shorthand exists because "no override" is the common case; the long
    // form is for the myth packs, which reshape the world's own time.
    expect(RegionDefinitionSchema.parse(base).packs).toEqual([{ slug: 'philosophy', eras: [] }])
  })

  it('accepts the long form with an override', () => {
    const region = RegionDefinitionSchema.parse({
      ...base,
      packs: [{ slug: 'mythology', eras: [base.eras[0]] }],
    })
    expect(region.packs[0].eras).toHaveLength(1)
  })

  it('defaults a root plate to no parent', () => {
    const rest = { ...base }
    delete (rest as { parent?: string }).parent
    expect(RegionDefinitionSchema.parse(rest).parent).toBeNull()
  })

  it('refuses a region that is its own parent', () => {
    expect(() => RegionDefinitionSchema.parse({ ...base, parent: 'india' })).toThrow()
  })

  it('refuses a plate with no periodization, which has no timeline to draw', () => {
    // `renderRegion` throws on this and `buildScale` throws on it again. Being
    // refused here means the message can name the file.
    expect(() => RegionDefinitionSchema.parse({ ...base, eras: [] })).toThrow()
  })

  it('refuses a camera outside the plate it opens', () => {
    // With `maxBounds` set from the same bbox this is a blank map the reader
    // cannot travel back from.
    expect(() => RegionDefinitionSchema.parse({
      ...base,
      defaultCamera: { center: [20, 25], zoom: 3.8 },
    })).toThrow()
  })

  it('refuses an opening zoom the plate does not allow', () => {
    expect(() => RegionDefinitionSchema.parse({
      ...base,
      defaultCamera: { center: [80.5, 21.5], zoom: 1.6 },
    })).toThrow()
  })

  it('refuses overlapping eras, which silently mislabel the track', () => {
    expect(() => RegionDefinitionSchema.parse({
      ...base,
      eras: [
        { ...base.eras[0], start: -3000, end: -1000 },
        { ...base.eras[1], start: -1500, end: 2026 },
      ],
    })).toThrow()
  })

  it('allows eras that merely touch, because one age ends where the next begins', () => {
    expect(() => RegionDefinitionSchema.parse(base)).not.toThrow()
  })

  it('refuses an era reaching outside the range the region claims', () => {
    // The timeline's own ends come from the eras, so this would offer years the
    // region says it does not cover.
    expect(() => RegionDefinitionSchema.parse({
      ...base,
      range: { start: -2000, end: 2026 },
    })).toThrow()
  })

  it('refuses the same pack laid over a region twice', () => {
    expect(() => RegionDefinitionSchema.parse({
      ...base,
      packs: ['philosophy', { slug: 'philosophy', eras: [] }],
    })).toThrow()
  })
})

describe('RegionSchema', () => {
  it('accepts a region with a camera and a range', () => {
    const region = {
      id: 'world',
      title: 'World',
      subtitle: 'everywhere, all of it',
      bbox: [-180, -85, 180, 85],
      minZoom: 0,
      maxZoom: 6,
      defaultCamera: { center: [20, 25], zoom: 1.6 },
      range: { start: -4000, end: 2026 },
      theme: 'rustic',
      eras: [],
    }
    expect(RegionSchema.parse(region).id).toBe('world')
  })
  it('rejects a bbox whose west exceeds its east', () => {
    const region = {
      id: 'broken',
      title: 'Broken',
      subtitle: 'nowhere',
      bbox: [10, -85, -10, 85],
      minZoom: 0,
      maxZoom: 6,
      defaultCamera: { center: [0, 0], zoom: 1 },
      range: { start: -100, end: 100 },
      theme: 'rustic',
      eras: [],
    }
    expect(() => RegionSchema.parse(region)).toThrow()
  })
})

describe('AtlasViewSchema', () => {
  const view = { pack: 'philosophy', year: -350 }

  it('defaults the optional halves of a view', () => {
    const parsed = AtlasViewSchema.parse(view)
    expect(parsed.entityId).toBeNull()
    expect(parsed.camera).toBeNull()
    expect(parsed.layers).toEqual([])
  })

  it('rejects a year outside the corpus', () => {
    expect(() => AtlasViewSchema.parse({ ...view, year: 9999 })).toThrow()
  })

  it('rejects a pack that is not a slug', () => {
    expect(() => AtlasViewSchema.parse({ ...view, pack: 'Philosophy' })).toThrow()
  })
})

describe('TourSchema', () => {
  const stop = {
    pack: 'mythology',
    year: -2000,
    entityId: 'gilgamesh',
    camera: { center: [45.64, 31.32], zoom: 4.6 },
    title: 'The First Question',
    locationLabel: 'Uruk, Sumer',
    narration: 'A king watches his friend die and refuses to accept it.',
  }
  const tour = {
    id: 'gods-grew-quiet',
    regionSlug: 'world',
    title: 'When the Gods Grew Quiet',
    subtitle: 'How explaining the world stopped being a story about someone',
    description: 'For two thousand years the answer to why anything happens was a name and a fight.',
    estimatedMinutes: 10,
    stops: [stop],
  }

  it('parses a tour and defaults its stop layers', () => {
    const parsed = TourSchema.parse(tour)
    expect(parsed.stops[0].layers).toEqual([])
    expect(parsed.stops[0].entityId).toBe('gilgamesh')
  })

  it('rejects a tour with no stops', () => {
    expect(() => TourSchema.parse({ ...tour, stops: [] })).toThrow()
  })
})

describe('LayerSchema', () => {
  const layer = {
    id: 'silk-road',
    name: 'Silk Road',
    kind: 'trade',
    paletteSlot: 1,
    valid: { start: -130, end: 1450 },
    note: 'Han embassies west to the Mediterranean.',
    features: {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Northern route' },
          geometry: { type: 'LineString', coordinates: [[108.9, 34.3], [76, 39.4]] },
        },
      ],
    },
  }

  it('parses a layer', () => {
    const parsed = LayerSchema.parse(layer)
    expect(parsed.kind).toBe('trade')
    expect(parsed.features.features).toHaveLength(1)
  })

  it('rejects a slot outside the palette', () => {
    expect(() => LayerSchema.parse({ ...layer, paletteSlot: LAYER_SLOTS + 1 })).toThrow()
    expect(() => LayerSchema.parse({ ...layer, paletteSlot: 0 })).toThrow()
  })

  it('rejects a kind the map has no dash for', () => {
    expect(() => LayerSchema.parse({ ...layer, kind: 'weather' })).toThrow()
  })

  it('rejects a period that ends before it starts', () => {
    expect(() => LayerSchema.parse({ ...layer, valid: { start: 900, end: 800 } })).toThrow()
  })

  it('rejects a features value that is not a FeatureCollection', () => {
    expect(() => LayerSchema.parse({ ...layer, features: { type: 'Feature' } })).toThrow()
    expect(() => LayerSchema.parse({ ...layer, features: [] })).toThrow()
    // This case isolates the type discriminator: same valid features array and structure,
    // but wrong type. Should fail only because type is not the FeatureCollection literal.
    expect(() =>
      LayerSchema.parse({
        ...layer,
        features: {
          type: 'GeometryCollection',
          features: [
            {
              type: 'Feature',
              properties: { name: 'Northern route' },
              geometry: { type: 'LineString', coordinates: [[108.9, 34.3], [76, 39.4]] },
            },
          ],
        },
      }),
    ).toThrow()
  })

  it('rejects a layer that draws nothing', () => {
    expect(() =>
      LayerSchema.parse({ ...layer, features: { type: 'FeatureCollection', features: [] } }),
    ).toThrow()
  })
})

describe('EntitySchema links', () => {
  it('refuses a Wikipedia link that is not https Wikipedia', () => {
    for (const wikipedia of ['javascript:alert(1)', 'http://en.wikipedia.org/wiki/Laozi', 'https://en.wikipedia.org.evil.example/wiki/Laozi']) {
      expect(EntitySchema.safeParse({ ...entity, wikipedia }).success).toBe(false)
    }
  })

  it('refuses an image with no source, a non-https source, or an unknown licence', () => {
    const image = { file: 'laozi.jpg', credit: 'Unknown author', licence: 'Public domain', source: 'https://commons.wikimedia.org/wiki/File:Laozi.jpg' }
    expect(EntitySchema.safeParse({ ...entity, image }).success).toBe(true)
    expect(EntitySchema.safeParse({ ...entity, image: { ...image, source: '' } }).success).toBe(false)
    expect(EntitySchema.safeParse({ ...entity, image: { ...image, source: 'javascript:alert(1)' } }).success).toBe(false)
    expect(EntitySchema.safeParse({ ...entity, image: { ...image, licence: 'All rights reserved' } }).success).toBe(false)
    expect(EntitySchema.safeParse({ ...entity, image: { ...image, file: '../x.jpg' } }).success).toBe(false)
  })
})

describe('isSlug', () => {
  it('accepts every slug shape the content uses', () => {
    for (const slug of ['world', 'philosophy', 'laozi', 'gods-grew-quiet', 'single-year-1175']) {
      expect(isSlug(slug)).toBe(true)
    }
  })

  it('refuses what only a typo or a probe would send', () => {
    for (const value of ['World', 'laozi/', "philosophy'--", '../etc', '', 'a'.repeat(65), 'two--dashes']) {
      expect(isSlug(value)).toBe(false)
    }
  })
})

describe('zod configuration', () => {
  it('never probes for eval, which the production CSP refuses', () => {
    expect(z.config().jitless).toBe(true)
  })
})
