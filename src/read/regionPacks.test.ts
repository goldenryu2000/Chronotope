import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { packs, regions } from '../db/schema'
import { importPack, LEGACY_CONTENT_DIR } from '../../scripts/import-legacy'
import { importRegions } from '../../scripts/import-regions'
import { memoryStorage } from '../publish/storage'
import { publishPack, publishRegion } from '../publish/publishPack'
import { packsOnRegion } from './regionPacks'

/**
 * Seeded here rather than assumed: Vitest gives no ordering guarantee between
 * files, and every db-backed suite in this repo owns its own fixture.
 *
 * Two packs are published and a third is imported but never published. That
 * third one is the point of the suite — an unpublished pack has no artifact to
 * fetch, so offering it in the switcher would be offering a dead end.
 */
beforeAll(async () => {
  await db.delete(regions)
  await db.delete(packs)
  for (const slug of ['philosophy', 'mythology', 'creatures']) {
    await importPack(`${LEGACY_CONTENT_DIR}/${slug}`)
  }
  await importRegions(['world', 'india'])

  const storage = memoryStorage()
  for (const slug of ['world', 'india']) {
    const [row] = await db.select().from(regions).where(eq(regions.slug, slug))
    await publishRegion(row.id, storage)
  }
  for (const slug of ['philosophy', 'mythology']) {
    const [pack] = await db.select().from(packs).where(eq(packs.slug, slug))
    await publishPack(pack.id, storage)
  }
})

describe('packsOnRegion', () => {
  it('lists every published pack laid over the region', async () => {
    const found = await packsOnRegion('world')
    expect(found.map((p) => p.slug)).toEqual(['mythology', 'philosophy'])
  })

  it('omits a pack that has been imported but never published', async () => {
    // `creatures` is on the region — it has an era set — but has no current
    // version, so `app/[region]/[pack]/page.tsx` would 404 on it. The switcher
    // must not offer a door that does not open.
    expect((await packsOnRegion('world')).map((p) => p.slug)).not.toContain('creatures')
  })

  it('carries what the switcher needs to render a row', async () => {
    const [first] = await packsOnRegion('world')
    expect(first.title.length).toBeGreaterThan(0)
    expect(first.subtitle.length).toBeGreaterThan(0)
    // The immutable artifact url, so switching is a fetch the client can make
    // on its own without ever reaching the database.
    expect(first.artifactUrl).toMatch(/\/packs\/mythology\/[0-9a-f]{16}\.json$/)
  })

  it('is empty for a region nothing has been laid over', async () => {
    expect(await packsOnRegion('no-such-region')).toEqual([])
  })
})

describe('packsOnRegion, on a plate smaller than the world', () => {
  it('offers the same packs, because each has figures inside india', async () => {
    const found = await packsOnRegion('india')
    expect(found.map((pack) => pack.slug)).toEqual(['mythology', 'philosophy'])
  })

  it('leaves out a pack with nobody on the plate', async () => {
    // A switcher entry that empties the map is the dead end the published-only
    // filter already guards against by another route. Proved by narrowing the
    // plate to open sea rather than by deleting content: the rule is about
    // where figures stand, not about which pack.
    await db.execute(sql`
      update regions
      set bbox = ST_SetSRID(ST_MakeEnvelope(-30, -30, -20, -20), 4326)
      where slug = 'india'
    `)
    try {
      expect(await packsOnRegion('india')).toEqual([])
    } finally {
      await importRegions(['world', 'india'])
    }
  })
})
