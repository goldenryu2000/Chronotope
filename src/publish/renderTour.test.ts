import { asc, eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { tourStops, tours } from '../db/schema'
import { seedWorldAndPacks } from '../db/testSeed'
import { TourSchema } from '../data/schemas'
import { seedTours } from '../../scripts/seed-tours'
import { renderTour } from './renderTour'

let tourId: string

describe('renderTour', () => {
  beforeAll(async () => {
    await seedWorldAndPacks()
    await seedTours()
    const [row] = await db.select().from(tours).where(eq(tours.slug, 'gods-grew-quiet'))
    tourId = row.id
  })

  it('renders stops in ordinal order, as slugs not uuids', async () => {
    const artifact = await renderTour(tourId)
    expect(TourSchema.parse(artifact)).toEqual(artifact)
    expect(artifact.id).toBe('gods-grew-quiet')
    expect(artifact.regionSlug).toBe('world')
    expect(artifact.stops).toHaveLength(13)
    expect(artifact.stops[0].entityId).toBe('gilgamesh')
    expect(artifact.stops[0].pack).toBe('mythology')
    // The flagship crosses packs, which is the case the player exists to serve.
    expect(new Set(artifact.stops.map((s) => s.pack)).size).toBeGreaterThan(1)
  })

  it('refuses a tour whose ordinals have a hole', async () => {
    const [stop] = await db.select().from(tourStops)
      .where(eq(tourStops.tourId, tourId)).orderBy(asc(tourStops.ordinal)).limit(1)
    await db.update(tourStops).set({ ordinal: 99 }).where(eq(tourStops.id, stop.id))
    await expect(renderTour(tourId)).rejects.toThrow(/ordinal/)
    await db.update(tourStops).set({ ordinal: stop.ordinal }).where(eq(tourStops.id, stop.id))
  })

  it('refuses a tour that does not exist', async () => {
    await expect(renderTour('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/no such tour/)
  })
})
