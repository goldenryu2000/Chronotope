import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { packs, regions } from '../db/schema'
import { importPack, LEGACY_CONTENT_DIR } from '../../scripts/import-legacy'
import { importRegions } from '../../scripts/import-regions'
import { memoryStorage } from '../publish/storage'
import { publishPack, publishRegion } from '../publish/publishPack'
import { publishedAtlases } from './atlasIndex'

/**
 * Seeded here rather than assumed, like every db-backed suite in this repo.
 *
 * The fixture is deliberately awkward: `world` gets two published packs and
 * one imported-but-unpublished, `india` is a plate drawn inside it, and
 * `atlantis` is a published region with no packs at all. Two of those are doors
 * that do not open, and the landing page's whole job is to only offer doors
 * that do.
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
  for (const slug of ['mythology', 'philosophy']) {
    const [pack] = await db.select().from(packs).where(eq(packs.slug, slug))
    await publishPack(pack.id, storage)
  }

  await db.insert(regions).values({
    slug: 'atlantis',
    title: 'Atlantis',
    subtitle: 'nowhere, briefly',
    bbox: 'SRID=4326;POLYGON((-10 -10,10 -10,10 10,-10 10,-10 -10))',
    minZoom: 0,
    maxZoom: 6,
    defaultCamera: { center: [0, 0], zoom: 2 },
    range: [-1000, 1000],
    theme: 'rustic',
    // Published as a region, so it is the missing packs that exclude it below
    // and not a missing artifact — the sharper of the two tests.
    currentArtifactKey: 'regions/atlantis/0123456789abcdef.json',
  })
})

describe('publishedAtlases', () => {
  it('groups packs under the region they are laid over', async () => {
    const found = await publishedAtlases()
    expect(found).toHaveLength(1)
    expect(found[0].slug).toBe('world')
    expect(found[0].packs.map((pack) => pack.slug)).toEqual(['mythology', 'philosophy'])
  })

  it('nests a plate under the one it is drawn inside, rather than beside it', async () => {
    // "India" listed next to "World" reads as an alternative, and it is not
    // one: it is a closer look at part of the same map.
    const [world] = await publishedAtlases()
    expect(world.children.map((child) => child.slug)).toEqual(['india'])
    expect(world.children[0].packs.map((pack) => pack.slug))
      .toEqual(['mythology', 'philosophy'])
  })

  it('leads with the root, so the hero is the widest map published', async () => {
    // The landing page draws its hero from the first entry, over a world-shaped
    // plate. Ordered by title alone, "India" sorts first and the hero becomes a
    // subcontinent stretched across a map of the world.
    const found = await publishedAtlases()
    expect(found[0].slug).toBe('world')
  })

  it('omits a pack imported but never published', async () => {
    const [world] = await publishedAtlases()
    expect(world.packs.map((pack) => pack.slug)).not.toContain('creatures')
  })

  it('omits a region with nothing published on it', async () => {
    // `/atlantis` is not a route — a region is only reachable through a pack.
    // Listing it would offer a heading with nothing under it to click.
    expect((await publishedAtlases()).map((entry) => entry.slug)).not.toContain('atlantis')
  })

  it('counts the figures in each pack', async () => {
    // The landing page leads with these. A pack card that says nothing about
    // how much is behind it is a link with no weight.
    const [world] = await publishedAtlases()
    for (const pack of world.packs) {
      expect(pack.entityCount).toBeGreaterThan(0)
    }
    const [philosophy] = world.packs.filter((pack) => pack.slug === 'philosophy')
    expect(philosophy.entityCount).toBe(81)
  })

  it('counts only the figures standing on the plate, not the whole pack', async () => {
    // A card on India's block saying "81 figures" over a map that draws ten is
    // a promise the atlas does not keep.
    const [world] = await publishedAtlases()
    const [india] = world.children
    const onIndia = india.packs.find((pack) => pack.slug === 'philosophy')
    const onWorld = world.packs.find((pack) => pack.slug === 'philosophy')
    expect(onIndia?.entityCount).toBeGreaterThan(0)
    expect(onIndia?.entityCount).toBeLessThan(onWorld?.entityCount as number)
  })

  it('carries what a region heading needs', async () => {
    const [world] = await publishedAtlases()
    expect(world.title).toBe('World')
    expect(world.subtitle.length).toBeGreaterThan(0)
  })
})
