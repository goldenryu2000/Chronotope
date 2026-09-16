import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { boundaries, regions } from '../src/db/schema'
import { importWorldRegion } from './import-legacy'
import { untiledRegions } from './publish-all'

/**
 * The ordering the cold start depends on, made impossible to get wrong
 * quietly.
 *
 * `build-tiles` records `tileset_key` on the region, `publish-all` copies it
 * into the artifact, and the client will not build a map without it. Run those
 * two in the other order and every command reports success while the atlas
 * renders a timeline over an empty page — the worst kind of failure, because
 * nothing points at which of the six steps was the wrong one.
 *
 * Asserted by membership rather than equality: the shared test database holds
 * whatever regions other suites have seeded, and this is a claim about `world`.
 */
let regionId: string

const square = 'SRID=4326;MULTIPOLYGON(((70 30,80 30,80 40,70 40,70 30)))'

describe('untiledRegions', () => {
  beforeAll(async () => {
    const [existing] = await db.select().from(regions).where(eq(regions.slug, 'world'))
    if (!existing) await importWorldRegion()
    const [row] = await db.select().from(regions).where(eq(regions.slug, 'world'))
    regionId = row.id

    await db.delete(boundaries)
    await db.update(regions).set({ tilesetKey: null }).where(eq(regions.id, regionId))
  })

  afterAll(async () => {
    await db.delete(boundaries)
  })

  it('ignores a region that has no boundaries at all', async () => {
    // Not every region must have a map. A region imported before its
    // boundaries exist is an ordinary intermediate state, not an error, and
    // treating it as one would fail the cold start's own sequence halfway
    // through — `import-legacy` runs before `import-boundaries`.
    expect(await untiledRegions()).not.toContain('world')
  })

  it('names a region whose boundaries have never been tiled', async () => {
    await db.insert(boundaries).values({
      name: 'Testland', valid: [1900, 1950], geom: square, source: 'test',
    })
    expect(await untiledRegions()).toContain('world')
  })

  it('is satisfied once the archive has been built', async () => {
    await db.update(regions)
      .set({ tilesetKey: 'tiles/world.pmtiles' })
      .where(eq(regions.id, regionId))
    expect(await untiledRegions()).not.toContain('world')
  })
})
