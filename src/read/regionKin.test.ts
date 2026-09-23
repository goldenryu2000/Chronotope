import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { packs, regions } from '../db/schema'
import { publishPack, publishRegion } from '../publish/publishPack'
import { memoryStorage } from '../publish/storage'
import { seedRegionsAndPacks } from '../db/testSeed'
import { childAtlases, entryPackFor, kinHref, parentAtlas, type RegionKin } from './regionKin'

/**
 * Seeded and published here rather than assumed: every db-backed suite in this
 * repo owns its own fixture, and this one needs *two* regions, which is the
 * whole point of it.
 *
 * `creatures` is imported but never published, so it is a placement that must
 * not become a link: a door into a plate whose pack has no artifact 404s.
 */
beforeAll(async () => {
  await seedRegionsAndPacks(['world', 'india'])

  const storage = memoryStorage()
  for (const slug of ['world', 'india']) {
    const [row] = await db.select().from(regions).where(eq(regions.slug, slug))
    await publishRegion(row.id, storage)
  }
  for (const slug of ['mythology', 'philosophy']) {
    const [row] = await db.select().from(packs).where(eq(packs.slug, slug))
    await publishPack(row.id, storage)
  }
})

describe('childAtlases', () => {
  it('offers the plate drawn inside the world', async () => {
    const found = await childAtlases('world')
    expect(found.map((kin) => kin.slug)).toEqual(['india'])
  })

  it('carries the plate\'s own edges, so the map can frame the way in', async () => {
    const [india] = await childAtlases('world')
    expect(india.bbox).toEqual([66, 5, 97.6, 37.6])
  })

  it('offers only packs that would actually open', async () => {
    // `creatures` is on india in the data and unpublished here.
    const [india] = await childAtlases('world')
    expect(india.packs).toEqual(['mythology', 'philosophy'])
    expect(india.entryPack).toBe('mythology')
  })

  it('offers nothing from inside a plate with nothing inside it', async () => {
    expect(await childAtlases('india')).toEqual([])
  })

  it('offers nothing for a region that does not exist', async () => {
    expect(await childAtlases('atlantis')).toEqual([])
  })
})

describe('parentAtlas', () => {
  it('names the plate india is drawn inside', async () => {
    const parent = await parentAtlas('india')
    expect(parent?.slug).toBe('world')
  })

  it('is null for a root atlas, which is what keeps the world free of chrome', async () => {
    expect(await parentAtlas('world')).toBeNull()
  })

  it('is null for a region that does not exist', async () => {
    expect(await parentAtlas('atlantis')).toBeNull()
  })
})

describe('keeping the reader\'s pack across a change of scale', () => {
  const kin: RegionKin = {
    slug: 'india',
    title: 'India',
    subtitle: 'the subcontinent, kingdom by kingdom',
    bbox: [66, 5, 97.6, 37.6],
    entryPack: 'creatures',
    packs: ['creatures', 'mythology'],
  }

  it('keeps the pack the reader is reading when the plate offers it', () => {
    expect(entryPackFor(kin, 'mythology')).toBe('mythology')
    expect(kinHref(kin, 'mythology')).toBe('/india/mythology')
  })

  it('falls back to the plate\'s own first pack when it does not', () => {
    expect(entryPackFor(kin, 'philosophy')).toBe('creatures')
    expect(kinHref(kin, 'philosophy')).toBe('/india/creatures')
  })
})
