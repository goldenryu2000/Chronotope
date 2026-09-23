import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { tours } from '../db/schema'
import { seedRegionsAndPacks } from '../db/testSeed'
import { seedTours } from '../../scripts/seed-tours'
import { currentTourUrl, publishedTours, tourOpening, toursOnRegion } from './currentTour'
import { publishAllTours } from './testSupport'

describe('the tour read path', () => {
  beforeAll(async () => {
    await seedRegionsAndPacks()
    await seedTours()
    await publishAllTours()
  })

  it('lists published tours on a region with their stop counts', async () => {
    const list = await toursOnRegion('world')
    const flagship = list.find((tour) => tour.slug === 'gods-grew-quiet')
    expect(flagship).toBeDefined()
    expect(flagship!.stops).toBe(13)
    expect(flagship!.artifactUrl).toContain('/tours/gods-grew-quiet/')
  })

  it('lists nothing for a region that has none', async () => {
    expect(await toursOnRegion('no-such-region')).toEqual([])
  })

  it('resolves the current artifact, and null for an unknown tour', async () => {
    expect(await currentTourUrl('gods-grew-quiet')).toContain('gods-grew-quiet')
    expect(await currentTourUrl('no-such-tour')).toBeNull()
  })

  it('reads a stop opening straight from Postgres', async () => {
    const opening = await tourOpening('gods-grew-quiet', 1)
    expect(opening).toMatchObject({ pack: 'mythology', year: -2000, entityId: 'gilgamesh', stops: 13 })
  })

  it('returns null for a stop past the end, so the route can 404', async () => {
    expect(await tourOpening('gods-grew-quiet', 99)).toBeNull()
  })

  it('groups every published tour under the region it walks', async () => {
    const regions = await publishedTours()
    // Two: the world's six, and the one that walks India's plate. Roots first,
    // matching `publishedAtlases`, so both landing-page lists read in the same
    // order rather than one of them putting India above the world.
    expect(regions.map((region) => region.slug)).toEqual(['world', 'india'])
    expect(regions[0]).toMatchObject({ slug: 'world', title: 'World' })

    const flagship = regions[0].tours.find((tour) => tour.slug === 'gods-grew-quiet')
    expect(flagship).toMatchObject({
      title: 'When the Gods Grew Quiet',
      stops: 13,
      estimatedMinutes: 10,
    })
    expect(regions[0].tours).toHaveLength(6)
  })

  it('leaves out a tour that has never been published', async () => {
    // A seeded tour with no current version is exactly the dead end the
    // landing page must not offer: its route 404s.
    const [row] = await db.select().from(tours).where(eq(tours.slug, 'who-am-i'))
    await db.update(tours).set({ currentVersionId: null }).where(eq(tours.id, row.id))

    const [world] = await publishedTours()
    expect(world.tours.map((tour) => tour.slug)).not.toContain('who-am-i')

    await db.update(tours).set({ currentVersionId: row.currentVersionId })
      .where(eq(tours.id, row.id))
  })
})
