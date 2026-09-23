import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { layers, tourStops, tours } from '../src/db/schema'
import { seedRegionsAndPacks } from '../src/db/testSeed'
import { renderTour } from '../src/publish/renderTour'
import { tourOpening } from '../src/read/currentTour'
import { importLayers } from './import-layers'
import { seedTours } from './seed-tours'

describe('seedTours', () => {
  beforeAll(async () => {
    // The flagship crosses packs, so one pack is not enough to seed it.
    await seedRegionsAndPacks()
    await db.delete(tours)
  })

  it('inserts every committed tour with its stops in order', async () => {
    const seeded = await seedTours()
    expect(seeded.length).toBeGreaterThanOrEqual(6)

    const [flagship] = await db.select().from(tours).where(eq(tours.slug, 'gods-grew-quiet'))
    expect(flagship.status).toBe('published')
    expect(flagship.visibility).toBe('official')
    expect(flagship.ownerId).toBeNull()

    const stops = await db.select().from(tourStops).where(eq(tourStops.tourId, flagship.id))
    expect(stops).toHaveLength(13)
    expect(stops.map((s) => s.ordinal).sort((a, b) => a - b))
      .toEqual([...Array(13)].map((_, i) => i + 1))
    // Every stop resolved to a real entity row, not a slug it merely spelled.
    expect(stops.every((s) => s.entityId !== null)).toBe(true)
  })

  it('is safe to re-run', async () => {
    await seedTours()
    const rows = await db.select().from(tours).where(eq(tours.slug, 'gods-grew-quiet'))
    expect(rows).toHaveLength(1)
  })

  it("writes a stop's layers as join rows", async () => {
    const layerDir = await mkdtemp(join(tmpdir(), 'layers-'))
    await writeFile(join(layerDir, 'probe-road.json'), JSON.stringify({
      id: 'probe-road', name: 'Probe Road', kind: 'trade', paletteSlot: 1,
      valid: { start: -1000, end: 1000 },
      note: 'A road written by this suite and read by nothing else.',
      features: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { name: 'Only leg' },
          geometry: { type: 'LineString', coordinates: [[20, 35], [25, 40]] },
        }],
      },
    }))
    await importLayers(layerDir)

    const dir = await mkdtemp(join(tmpdir(), 'tours-'))
    await writeFile(join(dir, 'lit.json'), JSON.stringify({
      id: 'lit-tour', regionSlug: 'world', title: 'Lit', subtitle: 'S',
      description: 'A tour whose one stop lights a road, and nothing else.',
      estimatedMinutes: 2,
      stops: [{
        pack: 'philosophy', year: -350, entityId: 'aristotle',
        camera: { center: [23.5, 39.0], zoom: 5 }, layers: ['probe-road'],
        title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30),
      }],
    }))

    await seedTours(dir)

    try {
      const [tour] = await db.select({ id: tours.id }).from(tours).where(eq(tours.slug, 'lit-tour'))
      const artifact = await renderTour(tour.id)
      expect(artifact.stops[0].layers).toEqual(['probe-road'])

      // The opening read has to agree with the artifact, and `toEqual` rather
      // than `toMatchObject` so it also pins what is *absent*: the stop's uuid
      // is deliberately not part of a view, and a spread would have leaked it.
      expect(await tourOpening('lit-tour', 1)).toEqual({
        pack: 'philosophy',
        year: -350,
        camera: { center: [23.5, 39.0], zoom: 5 },
        entityId: 'aristotle',
        layers: ['probe-road'],
        stops: 1,
      })
    } finally {
      // In a `finally`, because the join row is `restrict` on the layer: a
      // failed assertion that skipped this would make the *next* suite's
      // `delete(layers)` throw a foreign key error instead of reporting its
      // own result, turning one real failure into a page of false ones.
      await db.delete(tours).where(eq(tours.slug, 'lit-tour'))
      await db.delete(layers).where(eq(layers.slug, 'probe-road'))
    }
  })

  it('orders a stop\'s layers by palette slot, not by the order they were named', async () => {
    // The ordering `renderTour` and `tourOpening` both apply exists so an
    // artifact's hash does not move with the query plan's row order. It was
    // left uncovered on the grounds that it needed content that does not
    // exist yet; it does not, it needs a fixture with two layers on one stop.
    //
    // The tour names them slot-2 first, so seed order and slot order disagree
    // and dropping the ORDER BY changes the answer. `524b064` covers the same
    // kind of claim in `renderLayer` the same way.
    const layerDir = await mkdtemp(join(tmpdir(), 'layers-'))
    const road = (id: string, name: string, slot: number) => ({
      id, name, kind: 'trade', paletteSlot: slot,
      valid: { start: -1000, end: 1000 },
      note: 'A road written by this suite to pin an ordering, and read by nothing else.',
      features: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { name: 'Only leg' },
          geometry: { type: 'LineString', coordinates: [[20, 35], [25, 40]] },
        }],
      },
    })
    await writeFile(join(layerDir, 'a-road.json'), JSON.stringify(road('a-road', 'A Road', 1)))
    await writeFile(join(layerDir, 'b-road.json'), JSON.stringify(road('b-road', 'B Road', 2)))
    await importLayers(layerDir)

    const dir = await mkdtemp(join(tmpdir(), 'tours-'))
    await writeFile(join(dir, 'two.json'), JSON.stringify({
      id: 'two-tour', regionSlug: 'world', title: 'Two', subtitle: 'S',
      description: 'A tour whose one stop lights two roads, named out of order.',
      estimatedMinutes: 2,
      stops: [{
        pack: 'philosophy', year: -350, entityId: 'aristotle',
        camera: { center: [23.5, 39.0], zoom: 5 }, layers: ['b-road', 'a-road'],
        title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30),
      }],
    }))

    await seedTours(dir)

    try {
      const [tour] = await db.select({ id: tours.id }).from(tours).where(eq(tours.slug, 'two-tour'))
      expect((await renderTour(tour.id)).stops[0].layers).toEqual(['a-road', 'b-road'])
      expect((await tourOpening('two-tour', 1))?.layers).toEqual(['a-road', 'b-road'])
    } finally {
      await db.delete(tours).where(eq(tours.slug, 'two-tour'))
      await db.delete(layers).where(eq(layers.slug, 'a-road'))
      await db.delete(layers).where(eq(layers.slug, 'b-road'))
    }
  })

  it('breaks a tie on palette slot with the slug', async () => {
    // Two layers can share a slot. The schema only range-checks it, and
    // `import-layers` catches a collision within one directory while declining
    // a unique index on purpose, so that two layers can swap slots without a
    // temporary third value. Imported from separate directories, as below,
    // nothing objects at all.
    //
    // So the slot alone is not a total order, and ordering by it alone leaves
    // a tie to the query plan: the same hash instability the ordering exists
    // to prevent, just harder to notice.
    const road = (id: string, name: string) => ({
      id, name, kind: 'trade', paletteSlot: 4,
      valid: { start: -1000, end: 1000 },
      note: 'A road written by this suite to pin a tiebreak, and read by nothing else.',
      features: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { name: 'Only leg' },
          geometry: { type: 'LineString', coordinates: [[20, 35], [25, 40]] },
        }],
      },
    })
    for (const [id, name] of [['zeta-road', 'Zeta Road'], ['alpha-road', 'Alpha Road']]) {
      const one = await mkdtemp(join(tmpdir(), 'layers-'))
      await writeFile(join(one, `${id}.json`), JSON.stringify(road(id, name)))
      await importLayers(one)
    }

    const dir = await mkdtemp(join(tmpdir(), 'tours-'))
    await writeFile(join(dir, 'tie.json'), JSON.stringify({
      id: 'tie-tour', regionSlug: 'world', title: 'Tie', subtitle: 'S',
      description: 'A tour lighting two roads that share one palette slot.',
      estimatedMinutes: 2,
      stops: [{
        pack: 'philosophy', year: -350, entityId: 'aristotle',
        camera: { center: [23.5, 39.0], zoom: 5 }, layers: ['zeta-road', 'alpha-road'],
        title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30),
      }],
    }))

    await seedTours(dir)

    try {
      const [tour] = await db.select({ id: tours.id }).from(tours).where(eq(tours.slug, 'tie-tour'))
      expect((await renderTour(tour.id)).stops[0].layers).toEqual(['alpha-road', 'zeta-road'])
      expect((await tourOpening('tie-tour', 1))?.layers).toEqual(['alpha-road', 'zeta-road'])
    } finally {
      await db.delete(tours).where(eq(tours.slug, 'tie-tour'))
      await db.delete(layers).where(eq(layers.slug, 'zeta-road'))
      await db.delete(layers).where(eq(layers.slug, 'alpha-road'))
    }
  })

  it('lets a layer be re-imported while a stop still names it', async () => {
    // The regression this exists for. `import-layers` used to delete a layer by
    // slug and insert it again, which `tour_stop_layers` refuses the moment a
    // stop points at it: the key is `on delete restrict` on purpose, so that
    // removing a layer cannot quietly rewrite a published tour into one
    // narrating a route nobody can see.
    //
    // Re-importing is not removing, and the constraint was protecting
    // something else. Caught by running `make import` twice, not by a test:
    // the existing "replaces a layer rather than doubling its legs" case
    // passes either way, because nothing in it ever names the layer.
    const layerDir = await mkdtemp(join(tmpdir(), 'layers-'))
    const file = {
      id: 'reimport-road', name: 'Reimport Road', kind: 'trade', paletteSlot: 7,
      valid: { start: -1000, end: 1000 },
      note: 'A road written by this suite and imported twice on purpose.',
      features: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: { name: 'Only leg' },
          geometry: { type: 'LineString', coordinates: [[20, 35], [25, 40]] },
        }],
      },
    }
    await writeFile(join(layerDir, 'reimport-road.json'), JSON.stringify(file))
    await importLayers(layerDir)

    const dir = await mkdtemp(join(tmpdir(), 'tours-'))
    await writeFile(join(dir, 'held.json'), JSON.stringify({
      id: 'held-tour', regionSlug: 'world', title: 'Held', subtitle: 'S',
      description: 'A tour holding a reference to a road that gets re-imported.',
      estimatedMinutes: 2,
      stops: [{
        pack: 'philosophy', year: -350, entityId: 'aristotle',
        camera: { center: [23.5, 39.0], zoom: 5 }, layers: ['reimport-road'],
        title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30),
      }],
    }))
    await seedTours(dir)

    try {
      const [before] = await db.select().from(layers).where(eq(layers.slug, 'reimport-road'))

      // The whole assertion: this must not throw.
      await writeFile(join(layerDir, 'reimport-road.json'), JSON.stringify({
        ...file, note: 'The same road, re-read from a file that changed.',
      }))
      await importLayers(layerDir)

      const [after] = await db.select().from(layers).where(eq(layers.slug, 'reimport-road'))
      expect(after.note).toBe('The same road, re-read from a file that changed.')

      // Same row, not a new one wearing the same name. The slug is the
      // layer's identity, so a stop's foreign key still resolves.
      expect(after.id).toBe(before.id)
      const [tour] = await db.select({ id: tours.id }).from(tours).where(eq(tours.slug, 'held-tour'))
      expect((await renderTour(tour.id)).stops[0].layers).toEqual(['reimport-road'])
    } finally {
      await db.delete(tours).where(eq(tours.slug, 'held-tour'))
      await db.delete(layers).where(eq(layers.slug, 'reimport-road'))
    }
  })

  it('refuses a stop naming a layer that was never imported', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tours-'))
    await writeFile(join(dir, 'ghost.json'), JSON.stringify({
      id: 'ghost-tour', regionSlug: 'world', title: 'Ghost', subtitle: 'S',
      description: 'A tour naming a road that does not exist in any table.',
      estimatedMinutes: 2,
      stops: [{
        pack: 'philosophy', year: -350, entityId: 'aristotle',
        camera: { center: [23.5, 39.0], zoom: 5 }, layers: ['no-such-road'],
        title: 'One', locationLabel: 'Stagira', narration: 'x'.repeat(30),
      }],
    }))

    await expect(seedTours(dir)).rejects.toThrow(/no layer "no-such-road"/)
  })
})
