import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { packs, regions } from '../db/schema'
import { importPack, importWorldRegion, LEGACY_CONTENT_DIR } from '../../scripts/import-legacy'
import { memoryStorage } from '../publish/storage'
import { publishPack, publishRegion } from '../publish/publishPack'
import { currentArtifactUrl } from './currentArtifact'

const WORLD_BBOX = 'SRID=4326;POLYGON((-180 -85,180 -85,180 85,-180 85,-180 -85))'

/**
 * Vitest runs this repo's `*.test.ts` files serially against one shared
 * Postgres (see vitest.config.ts's `fileParallelism: false` note), and file
 * discovery order does not guarantee another file's beforeAll — the one that
 * seeds and publishes 'world' + 'philosophy' — runs before this one. Rather
 * than assume it did, seed and publish the fixture here directly, exactly as
 * every other db-backed test file in this repo does.
 */
beforeAll(async () => {
  await db.delete(regions)
  await db.delete(packs)
  await importWorldRegion()
  await importPack(`${LEGACY_CONTENT_DIR}/philosophy`, 'world')

  const storage = memoryStorage()
  const [pack] = await db.select().from(packs).where(eq(packs.slug, 'philosophy'))
  const [region] = await db.select().from(regions).where(eq(regions.slug, 'world'))
  await publishPack(pack.id, storage)
  await publishRegion(region.id, storage)
})

describe('currentArtifactUrl', () => {
  it('resolves a published pack to its immutable url', async () => {
    const url = await currentArtifactUrl('packs', 'philosophy')
    expect(url).toMatch(/\/packs\/philosophy\/[0-9a-f]{16}\.json$/)
  })

  it('resolves a published region too', async () => {
    const url = await currentArtifactUrl('regions', 'world')
    expect(url).toMatch(/\/regions\/world\/[0-9a-f]{16}\.json$/)
  })

  it('returns null for a slug with no packs row at all', async () => {
    expect(await currentArtifactUrl('packs', 'no-such-pack')).toBeNull()
  })

  // Distinct from the "no row at all" case above: in this design drafts are
  // database state, not an exotic edge case. A pack in `draft` or
  // `in_review` is a real `packs` row with `currentVersionId` still null,
  // and that is the normal condition for anything not yet published — the
  // route must 404 for it just the same.
  it('returns null for a pack that exists but has never been published', async () => {
    const [draft] = await db.insert(packs).values({
      slug: 'draft-pack',
      title: 'Draft Pack',
      subtitle: 'exists, never published',
      spanLabel: 'test span',
      range: [-100, 1],
      startYear: -100,
    }).returning()
    expect(draft.currentVersionId).toBeNull()

    try {
      expect(await currentArtifactUrl('packs', 'draft-pack')).toBeNull()
    } finally {
      // Don't leak this fixture into other test files sharing the database.
      await db.delete(packs).where(eq(packs.id, draft.id))
    }
  })

  // Same guarantee, region side: a region row can exist with
  // `currentArtifactKey` still null (never published).
  it('returns null for a region that exists but has never been published', async () => {
    const [draft] = await db.insert(regions).values({
      slug: 'draft-region',
      title: 'Draft Region',
      subtitle: 'exists, never published',
      bbox: WORLD_BBOX,
      defaultCamera: { center: [0, 0], zoom: 1 },
      range: [-100, 1],
    }).returning()
    expect(draft.currentArtifactKey).toBeNull()

    try {
      expect(await currentArtifactUrl('regions', 'draft-region')).toBeNull()
    } finally {
      await db.delete(regions).where(eq(regions.id, draft.id))
    }
  })
})
