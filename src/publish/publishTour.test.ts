import { asc, eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { layerFeatures, layers, packs, tourStopLayers, tourStops, tourVersions, tours } from '../db/schema'
import { seedRegionsAndPacks } from '../db/testSeed'
import { TourSchema } from '../data/schemas'
import { seedTours } from '../../scripts/seed-tours'
import { publishLayer } from './publishLayer'
import { publishPack } from './publishPack'
import { publishTour } from './publishTour'
import { renderTour } from './renderTour'
import { memoryStorage } from './storage'

let tourId: string

describe('publishTour', () => {
  beforeAll(async () => {
    await seedRegionsAndPacks()
    await seedTours()
    // A tour is validated against *published* packs, so the packs it visits
    // must have a current version before any of this can succeed.
    const storage = memoryStorage()
    for (const pack of await db.select().from(packs)) await publishPack(pack.id, storage)

    // And against published *layers*, now that committed stops light them.
    // `publish-all` does layers before tours for this reason; a fixture that
    // skipped them would fail every publish here on "no published layer",
    // which is rule 5 being right about a fixture that was wrong.
    for (const layer of await db.select().from(layers)) await publishLayer(layer.id, storage)

    const [row] = await db.select().from(tours).where(eq(tours.slug, 'gods-grew-quiet'))
    tourId = row.id
    await db.delete(tourVersions).where(eq(tourVersions.tourId, tourId))
  })

  it('writes an artifact and advances the current pointer', async () => {
    const storage = memoryStorage()
    const { key, version } = await publishTour(tourId, storage)

    expect(version).toBe(1)
    expect(key.startsWith('tours/gods-grew-quiet/')).toBe(true)

    const stored = TourSchema.parse(JSON.parse(storage.objects.get(key)!))
    expect(stored).toEqual(await renderTour(tourId))

    const [tour] = await db.select().from(tours).where(eq(tours.id, tourId))
    const [live] = await db.select().from(tourVersions)
      .where(eq(tourVersions.id, tour.currentVersionId!))
    expect(live.artifactKey).toBe(key)
  })

  it('republishing unchanged content reuses the key and bumps the version', async () => {
    const storage = memoryStorage()
    const first = await publishTour(tourId, storage)
    const second = await publishTour(tourId, storage)
    expect(second.key).toBe(first.key)
    expect(second.version).toBe(first.version + 1)
  })

  it('refuses when a pack the tour visits has no published version', async () => {
    const [pack] = await db.select().from(packs).where(eq(packs.slug, 'mythology'))
    const restore = pack.currentVersionId
    await db.update(packs).set({ currentVersionId: null }).where(eq(packs.id, pack.id))
    await expect(publishTour(tourId, memoryStorage())).rejects.toThrow(/mythology/)
    await db.update(packs).set({ currentVersionId: restore }).where(eq(packs.id, pack.id))
  })

  it('refuses a stop that is not honest, naming the stop', async () => {
    // The year is not the point; the point is that a year outside a lifetime
    // cannot reach an artifact. The ported build published exactly this.
    const [stop] = await db.select().from(tourStops)
      .where(eq(tourStops.tourId, tourId)).orderBy(asc(tourStops.ordinal)).limit(1)
    await db.update(tourStops).set({ year: 1500 }).where(eq(tourStops.id, stop.id))
    await expect(publishTour(tourId, memoryStorage())).rejects.toThrow(/stop 1/)
    await db.update(tourStops).set({ year: stop.year }).where(eq(tourStops.id, stop.id))
  })

  /*
   * A road across central Asia, roughly where the Silk Road runs, and
   * deliberately not square: its longitudes are 60 to 70 and its latitudes 35
   * to 40, so a bbox read in the wrong axis order describes somewhere else.
   */
  const probeGeometry = {
    type: 'MultiLineString',
    coordinates: [[[60, 35], [65, 37], [70, 40]]],
  }

  /** North of 85, which is where the seeded world region's bbox stops. */
  const arcticGeometry = {
    type: 'MultiLineString',
    coordinates: [[[60, 87], [65, 88], [70, 89]]],
  }

  async function lightFirstStop(layer: {
    slug: string
    valid: [number, number]
    key: string | null
    status?: 'draft' | 'published'
    /** `null` for a layer row carrying no features at all. */
    geometry?: object | null
  }) {
    const [stop] = await db.select().from(tourStops)
      .where(eq(tourStops.tourId, tourId)).orderBy(asc(tourStops.ordinal)).limit(1)
    // Deleted first, so a run that died between these two inserts does not
    // leave a slug behind that fails the next run at the unique index.
    await db.delete(layers).where(eq(layers.slug, layer.slug))
    const [row] = await db.insert(layers).values({
      slug: layer.slug, name: 'Probe Road', kind: 'trade', paletteSlot: 1,
      valid: layer.valid, note: 'A road inserted by the publish suite.',
      // `published`, because that is now half of what `publishTour` asks for,
      // and the column defaults to `draft`.
      status: layer.status ?? 'published',
      currentArtifactKey: layer.key,
    }).returning()
    const geometry = layer.geometry === undefined ? probeGeometry : layer.geometry
    if (geometry) {
      await db.insert(layerFeatures).values({
        layerId: row.id,
        name: 'leg 1',
        geom: sql`ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(geometry)})), 4326)`,
      })
    }
    await db.insert(tourStopLayers).values({ stopId: stop.id, layerId: row.id })
    return async () => {
      await db.delete(tourStopLayers).where(eq(tourStopLayers.layerId, row.id))
      // `layer_features` cascades off the layer, so one delete clears both.
      await db.delete(layers).where(eq(layers.id, row.id))
    }
  }

  /** Turns the first stop into a layer-led one: nobody selected, camera fixed. */
  async function pointFirstStopAt(center: [number, number]) {
    const [stop] = await db.select().from(tourStops)
      .where(eq(tourStops.tourId, tourId)).orderBy(asc(tourStops.ordinal)).limit(1)
    await db.update(tourStops)
      .set({ entityId: null, camera: { center, zoom: 4 } })
      .where(eq(tourStops.id, stop.id))
    return async () => {
      await db.update(tourStops)
        .set({ entityId: stop.entityId, camera: stop.camera })
        .where(eq(tourStops.id, stop.id))
    }
  }

  /*
   * Rule 5 was inert for the whole of milestone A: `publishTour` passed an
   * empty layer map, so every branch below was unreachable and untested. These
   * two tests are what say it is live, and they drive it through `publishTour`
   * rather than calling `validateTour` directly, because the thing that was
   * missing was the map, not the rule.
   */
  it('refuses a stop lighting a layer that does not draw in its year', async () => {
    // The flagship opens in -2000; this road is in use from 0 to 1000. A tour
    // that lit it there would narrate a route the map leaves blank.
    const clean = await lightFirstStop({
      slug: 'publish-probe-road', valid: [0, 1001], key: 'layers/publish-probe-road/x.json',
    })
    try {
      await expect(publishTour(tourId, memoryStorage()))
        .rejects.toThrow(/layer "publish-probe-road" does not draw in -2000 \(0 to 1000\)/)
    } finally {
      await clean()
    }
  })

  it('refuses a stop lighting a layer that has never been published', async () => {
    // Imported but not published: the row exists, the artifact does not, and
    // the reader's browser only ever sees artifacts.
    const clean = await lightFirstStop({
      slug: 'publish-ghost-road', valid: [-3000, 1001], key: null,
    })
    try {
      await expect(publishTour(tourId, memoryStorage()))
        .rejects.toThrow(/no published layer "publish-ghost-road"/)
    } finally {
      await clean()
    }
  })

  /*
   * The three ways a layer row can exist and still never reach the reader.
   * `publishTour` asks for exactly what `layersOnRegion` offers the browser,
   * so each of these is absent from the validator's map and rule 5 refuses the
   * stop that lights it. Validating against a looser set would publish a stop
   * that lights nothing.
   */
  it('refuses a stop lighting a layer whose status went back to draft', async () => {
    // `publishLayer` sets the artifact key and never touches the status, so a
    // row can carry a key it no longer serves under.
    const clean = await lightFirstStop({
      slug: 'publish-draft-road', valid: [-3000, 1001], status: 'draft',
      key: 'layers/publish-draft-road/x.json',
    })
    try {
      await expect(publishTour(tourId, memoryStorage()))
        .rejects.toThrow(/no published layer "publish-draft-road"/)
    } finally {
      await clean()
    }
  })

  it('refuses a stop lighting a layer with no features', async () => {
    const clean = await lightFirstStop({
      slug: 'publish-empty-road', valid: [-3000, 1001], geometry: null,
      key: 'layers/publish-empty-road/x.json',
    })
    try {
      await expect(publishTour(tourId, memoryStorage()))
        .rejects.toThrow(/no published layer "publish-empty-road"/)
    } finally {
      await clean()
    }
  })

  it('refuses a stop lighting a layer that does not reach the tour\'s region', async () => {
    // A road across the high Arctic. Published, with features, and outside the
    // world region's bbox, so the menu never offers it and the map never draws
    // it.
    const clean = await lightFirstStop({
      slug: 'publish-arctic-road', valid: [-3000, 1001], geometry: arcticGeometry,
      key: 'layers/publish-arctic-road/x.json',
    })
    try {
      await expect(publishTour(tourId, memoryStorage()))
        .rejects.toThrow(/no published layer "publish-arctic-road"/)
    } finally {
      await clean()
    }
  })

  /*
   * Rule 7 through the pipeline. The unit tests hand `validateView` a bbox;
   * these two say the bbox `publishTour` supplies is the one PostGIS holds,
   * in the axis order the rule reads. The road runs 60 to 70 east and 35 to
   * 40 north, so a transposed bbox puts the accepting camera outside and this
   * pair stops agreeing.
   */
  it('refuses a layer-led stop whose camera is nowhere near its route', async () => {
    const unlight = await lightFirstStop({
      slug: 'publish-rule7-road', valid: [-3000, 1001],
      key: 'layers/publish-rule7-road/x.json',
    })
    const restore = await pointFirstStopAt([-60, -20])
    try {
      await expect(publishTour(tourId, memoryStorage()))
        .rejects.toThrow(/stop 1[\s\S]*is outside publish-rule7-road/)
    } finally {
      await restore()
      await unlight()
    }
  })

  it('accepts a layer-led stop whose camera is over its route', async () => {
    const unlight = await lightFirstStop({
      slug: 'publish-rule7-road', valid: [-3000, 1001],
      key: 'layers/publish-rule7-road/x.json',
    })
    const restore = await pointFirstStopAt([65, 37])
    try {
      const { key } = await publishTour(tourId, memoryStorage())
      expect(key.startsWith('tours/gods-grew-quiet/')).toBe(true)
    } finally {
      await restore()
      await unlight()
    }
  })
})
