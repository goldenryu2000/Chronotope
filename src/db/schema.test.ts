import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from './client'
import {
  eraSets, layerFeatures, layers, packs, regions, tourStopLayers, tourStops, tourVersions, tours,
} from './schema'
import { LAYER_SLOTS } from '../theme/layerSlots'
import { deleteAllLayers } from './testSeed'

const WORLD_BBOX = 'SRID=4326;POLYGON((-180 -85,180 -85,180 85,-180 85,-180 -85))'

/**
 * Drizzle wraps driver errors in an `Error` whose message is the failed SQL,
 * so asserting on the message would not tell you *which* constraint fired.
 * The PostgresError underneath carries the SQLSTATE and the constraint name.
 */
async function violation(query: Promise<unknown>) {
  try {
    await query
    return { code: null, constraint: null }
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause
    return { code: cause?.code ?? null, constraint: cause?.constraint_name ?? null }
  }
}

describe('schema', () => {
  beforeAll(async () => {
    // era_sets cascades from regions, so this clears both.
    await db.delete(regions)
    await db.insert(regions).values({
      slug: 'world',
      title: 'World',
      subtitle: 'everywhere, all of it',
      bbox: WORLD_BBOX,
      minZoom: 0,
      maxZoom: 6,
      defaultCamera: { center: [20, 25], zoom: 1.6 },
      range: [-4000, 2027],
      theme: 'rustic',
      visibility: 'official',
      status: 'published',
    })
  })

  it('round-trips a region with a bbox and a validity range', async () => {
    const [row] = await db
      .select({
        slug: regions.slug,
        range: regions.range,
        // The bare column reads back as hex EWKB — see the note on `geometry`
        // in ./types. Readable geometry has to be asked for.
        bbox: sql<string>`ST_AsEWKT(${regions.bbox})`,
      })
      .from(regions)
      .where(eq(regions.slug, 'world'))

    expect(row.slug).toBe('world')
    expect(row.range).toEqual([-4000, 2027])
    expect(row.bbox).toBe(WORLD_BBOX)
  })

  it('hands back the bare geometry column as hex EWKB, not EWKT', async () => {
    const [row] = await db
      .select({ bbox: regions.bbox })
      .from(regions)
      .where(eq(regions.slug, 'world'))

    // Documenting the asymmetry deliberately: if this ever starts returning
    // EWKT, the comment on `geometry` in ./types is what needs updating.
    expect(row.bbox).toMatch(/^0103000020E6100000/)
  })

  it('answers a temporal containment query', async () => {
    const result = await db.execute(
      sql`select 1 from ${regions} where ${regions.range} @> 1600 limit 1`,
    )
    // postgres-js returns an array-like `Result`, not a `{ rows }` object:
    // the row count is the array's own length.
    expect(result.length).toBe(1)
  })

  it('stores a wholly-BCE span with an exclusive end and reads it back', async () => {
    // A span whose last inclusive year is 500 BCE. The project's convention is
    // that a last-inclusive year Y is stored as Y+1, so -500 becomes -499.
    await db.insert(regions).values({
      slug: 'antiquity',
      title: 'Antiquity',
      subtitle: 'before the common era',
      bbox: WORLD_BBOX,
      defaultCamera: { center: [30, 35], zoom: 3 },
      range: [-604, -499],
    })

    const [row] = await db
      .select({ range: regions.range })
      .from(regions)
      .where(eq(regions.slug, 'antiquity'))
    expect(row.range).toEqual([-604, -499])

    // The arithmetic, not just the tuple: the last inclusive year is in, the
    // exclusive bound is out. A text column would fail both of these.
    const inside = await db.execute(
      sql`select 1 from ${regions} where ${regions.slug} = 'antiquity' and ${regions.range} @> -500`,
    )
    const outside = await db.execute(
      sql`select 1 from ${regions} where ${regions.slug} = 'antiquity' and ${regions.range} @> -499`,
    )
    expect(inside.length).toBe(1)
    expect(outside.length).toBe(0)
  })

  it('rejects a range that collapses to empty', async () => {
    // [1500,1500) is `empty` in Postgres, which is what forgetting the +1 on a
    // single-year span produces. The check constraint fails the insert here,
    // rather than letting a later read blow up far from the cause.
    const outcome = await violation(
      db.insert(regions).values({
        slug: 'instant',
        title: 'Instant',
        subtitle: 'no time at all',
        bbox: WORLD_BBOX,
        defaultCamera: { center: [0, 0], zoom: 1 },
        range: [1500, 1500],
      }),
    )
    // 23514 is check_violation.
    expect(outcome).toEqual({ code: '23514', constraint: 'regions_range_not_empty' })
  })

  it('allows only one default era set per region', async () => {
    const [world] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(eq(regions.slug, 'world'))

    await db.insert(eraSets).values({ regionId: world.id, packId: null })

    // NULLS DISTINCT would let this second default periodization through.
    const outcome = await violation(
      db.insert(eraSets).values({ regionId: world.id, packId: null }),
    )
    // 23505 is unique_violation.
    expect(outcome).toEqual({ code: '23505', constraint: 'one_era_set_per_pair' })
  })
})

describe('tours', () => {
  let regionId: string
  let packId: string

  beforeAll(async () => {
    const [region] = await db.select().from(regions).where(eq(regions.slug, 'world'))
    const [pack] = await db.select().from(packs).where(eq(packs.slug, 'philosophy'))
    regionId = region.id
    packId = pack.id
    await db.delete(tours).where(eq(tours.slug, 'schema-probe'))
  })

  const probe = () => ({
    slug: 'schema-probe', regionId, title: 'Probe', subtitle: 'S',
    description: 'A tour inserted by the schema suite and deleted again.',
    estimatedMinutes: 3,
  })

  it('holds a tour, its stops and its versions', async () => {
    const [tour] = await db.insert(tours).values(probe()).returning()

    await db.insert(tourStops).values({
      tourId: tour.id, ordinal: 1, packId, year: -350,
      camera: { center: [23.5, 39.0], zoom: 5 },
      title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30),
    })

    const stops = await db.select().from(tourStops).where(eq(tourStops.tourId, tour.id))
    expect(stops).toHaveLength(1)
    expect(stops[0].entityId).toBeNull()

    // Deleting the tour takes its stops with it.
    await db.delete(tours).where(eq(tours.id, tour.id))
    expect(await db.select().from(tourStops).where(eq(tourStops.tourId, tour.id))).toHaveLength(0)
    expect(await db.select().from(tourVersions).where(eq(tourVersions.tourId, tour.id)))
      .toHaveLength(0)
  })

  it('refuses two stops at the same ordinal in one tour', async () => {
    const [tour] = await db.insert(tours).values(probe()).returning()
    const stop = {
      tourId: tour.id, ordinal: 1, packId, year: -350,
      title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30),
    }
    await db.insert(tourStops).values(stop)

    const outcome = await violation(db.insert(tourStops).values(stop))
    expect(outcome).toEqual({ code: '23505', constraint: 'stop_ordinal_per_tour' })

    await db.delete(tours).where(eq(tours.id, tour.id))
  })

  it('refuses a pack claiming the reserved tours slug', async () => {
    // `/world/tours/x` would otherwise be ambiguous with `/[region]/[pack]/[entity]`.
    const outcome = await violation(
      db.insert(packs).values({
        slug: 'tours', title: 'T', subtitle: 'S', spanLabel: 'lived',
        range: [-100, 100], startYear: 0,
      }),
    )
    // 23514 is check_violation.
    expect(outcome).toEqual({ code: '23514', constraint: 'packs_slug_not_reserved' })
  })

  describe('tour_stop_layers', () => {
    let layerId: string

    beforeAll(async () => {
      await db.delete(layers).where(eq(layers.slug, 'schema-probe-road'))
      const [layer] = await db.insert(layers).values({
        slug: 'schema-probe-road', name: 'Probe Road', kind: 'trade', paletteSlot: 1,
        valid: [0, 1001], note: 'A road inserted by the schema suite.',
      }).returning()
      layerId = layer.id
    })

    // Its own cleanup, rather than relying on `describe('layers')` below
    // happening to run a blanket delete afterwards. That is a real dependency
    // between two sibling blocks, and it is invisible from either one.
    afterAll(async () => {
      await db.delete(layers).where(eq(layers.slug, 'schema-probe-road'))
    })

    it('refuses to delete a layer a stop still names', async () => {
      const [tour] = await db.insert(tours).values(probe()).returning()
      try {
        const [stop] = await db.insert(tourStops).values({
          tourId: tour.id, ordinal: 1, packId, year: 500,
          camera: null, title: 'One', locationLabel: 'On the road', narration: 'x'.repeat(30),
        }).returning()
        await db.insert(tourStopLayers).values({ stopId: stop.id, layerId })

        // The point of `restrict`. Under `cascade` this would succeed and quietly
        // rewrite a published tour into one narrating a route nobody can see.
        // 23503 is foreign_key_violation.
        const outcome = await violation(db.delete(layers).where(eq(layers.id, layerId)))
        expect(outcome.code).toBe('23503')
      } finally {
        // In a `finally` because of what a leaked tour costs here, which is not
        // one extra red test. The next test's `probe()` would collide on
        // `tours_slug_unique`, and the sibling `describe('layers')` deletes
        // every layer in a `beforeEach`, which the surviving join row refuses
        // with the very foreign key this test is about. One real failure would
        // print as six, none of them naming the cause.
        await db.delete(tours).where(eq(tours.id, tour.id))
      }
    })

    it('drops its rows when the stop goes', async () => {
      const [tour] = await db.insert(tours).values(probe()).returning()
      try {
        const [stop] = await db.insert(tourStops).values({
          tourId: tour.id, ordinal: 1, packId, year: 500,
          camera: null, title: 'One', locationLabel: 'On the road', narration: 'x'.repeat(30),
        }).returning()
        await db.insert(tourStopLayers).values({ stopId: stop.id, layerId })

        await db.delete(tours).where(eq(tours.id, tour.id))
        expect(await db.select().from(tourStopLayers).where(eq(tourStopLayers.stopId, stop.id)))
          .toHaveLength(0)

        // And the layer itself survives, because nothing names it any more.
        expect(await db.select().from(layers).where(eq(layers.id, layerId))).toHaveLength(1)
      } finally {
        await db.delete(tours).where(eq(tours.id, tour.id))
      }
    })
  })
})

describe('layers', () => {
  beforeEach(async () => {
    await deleteAllLayers()
  })

  it('stores a layer and its features', async () => {
    const [layer] = await db.insert(layers).values({
      slug: 'test-road', name: 'Test Road', kind: 'trade', paletteSlot: 1,
      valid: [-130, 1451], note: 'A road that exists only in this suite.',
      visibility: 'official', status: 'published',
    }).returning()

    await db.insert(layerFeatures).values({
      layerId: layer.id,
      name: 'Only leg',
      geom: sql`ST_SetSRID(ST_Multi(ST_GeomFromText('LINESTRING(0 0, 10 10)')), 4326)`,
    })

    const [row] = await db
      .select({ slug: layers.slug, valid: layers.valid, kind: layers.kind })
      .from(layers).where(eq(layers.id, layer.id))
    expect(row.valid).toEqual([-130, 1451])
    expect(row.kind).toBe('trade')

    const features = await db.select({ name: layerFeatures.name })
      .from(layerFeatures).where(eq(layerFeatures.layerId, layer.id))
    expect(features).toHaveLength(1)
  })

  it('refuses an empty validity range', async () => {
    // [900,900) is `empty` in Postgres, which is what forgetting the +1 on a
    // single-year layer produces. `violation` is the helper at the top of this
    // file: it reports which constraint fired, where a message assertion would
    // only report that the SQL failed.
    const outcome = await violation(
      db.insert(layers).values({
        slug: 'nowhen', name: 'Nowhen', kind: 'idea', paletteSlot: 2,
        valid: [900, 900], note: 'A range that collapses to empty.',
      }),
    )
    expect(outcome).toEqual({ code: '23514', constraint: 'layers_valid_not_empty' })
  })

  it('refuses a slot outside the palette', async () => {
    const outcome = await violation(
      db.insert(layers).values({
        slug: 'offpalette', name: 'Off palette', kind: 'idea', paletteSlot: 99,
        valid: [0, 100], note: 'A slot with no colour behind it.',
      }),
    )
    expect(outcome).toEqual({ code: '23514', constraint: 'layers_palette_slot_in_range' })
  })

  it('bounds the slot at exactly the number of colours a theme defines', async () => {
    // Slot 99 above proves there is *a* bound. This proves it is the right
    // one. The constraint's `between 1 and 9` is typed out by hand in SQL,
    // because a check cannot import `LAYER_SLOTS`, so a tenth colour added to
    // the themes, or a ninth taken away, would leave the two disagreeing with
    // nothing to say so.
    await db.insert(layers).values({
      slug: 'lastslot', name: 'Last slot', kind: 'idea', paletteSlot: LAYER_SLOTS,
      valid: [0, 100], note: 'The highest slot a theme has a colour for.',
    })
    const outcome = await violation(
      db.insert(layers).values({
        slug: 'pastslot', name: 'Past slot', kind: 'idea', paletteSlot: LAYER_SLOTS + 1,
        valid: [0, 100], note: 'One past the colours a theme defines.',
      }),
    )
    expect(outcome).toEqual({ code: '23514', constraint: 'layers_palette_slot_in_range' })
  })

  it("takes a layer's features with it when it goes", async () => {
    const [layer] = await db.insert(layers).values({
      slug: 'doomed', name: 'Doomed', kind: 'migration', paletteSlot: 3,
      valid: [0, 100], note: 'Deleted by this test.',
    }).returning()
    await db.insert(layerFeatures).values({
      layerId: layer.id, name: 'leg',
      geom: sql`ST_SetSRID(ST_Multi(ST_GeomFromText('LINESTRING(0 0, 1 1)')), 4326)`,
    })

    await db.delete(layers).where(eq(layers.id, layer.id))
    expect(await db.select().from(layerFeatures).where(eq(layerFeatures.layerId, layer.id)))
      .toHaveLength(0)
  })
})
