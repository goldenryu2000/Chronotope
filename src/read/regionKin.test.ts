import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { packs, regions } from '../db/schema'
import { publishPack, publishRegion } from '../publish/publishPack'
import { memoryStorage } from '../publish/storage'
import { seedRegionsAndPacks } from '../db/testSeed'
import {
  childrenOfPlate, entryPackFor, findPlate, flattenPlates, parentOfPlate, plateHref,
  plateTree, type Plate,
} from './regionKin'

/**
 * Seeded and published here rather than assumed: every db-backed suite in this
 * repo owns its own fixture, and this one needs *two* regions, which is the
 * whole point of it.
 *
 * `creatures` is imported but never published, so it is a placement that must
 * not become a link: a way into a plate whose pack has no artifact 404s.
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

describe('plateTree', () => {
  it('nests a plate inside the one it is drawn in', async () => {
    const tree = await plateTree()
    expect(tree.map((plate) => plate.slug)).toEqual(['world'])
    expect(tree[0].children.map((plate) => plate.slug)).toEqual(['india'])
  })

  it('carries each plate\'s own edges, so the map can measure it against the view', async () => {
    const india = findPlate(await plateTree(), 'india') as Plate
    expect(india.bbox).toEqual([66, 5, 97.6, 37.6])
  })

  it('offers only packs that would actually open', async () => {
    // `creatures` is on india in the data and unpublished here.
    const india = findPlate(await plateTree(), 'india') as Plate
    expect(india.packs).toEqual(['mythology', 'philosophy'])
    expect(india.entryPack).toBe('mythology')
  })

  it('leaves out a plate with nobody on it', async () => {
    // Narrowed to open sea rather than emptied of content: the rule is about
    // where figures stand, not about which pack.
    const [india] = await db.select().from(regions).where(eq(regions.slug, 'india'))
    await db.update(regions)
      .set({ bbox: 'SRID=4326;POLYGON((-30 -30,-20 -30,-20 -20,-30 -20,-30 -30))' })
      .where(eq(regions.id, india.id))
    try {
      expect(findPlate(await plateTree(), 'india')).toBeNull()
    } finally {
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
    }
  })

  it('leads with the root, so every list of atlases reads in one order', async () => {
    // Ordered by title alone, "India" sorts above "World" and the landing
    // page's hero becomes a subcontinent stretched over a map of the world.
    expect((await plateTree())[0].slug).toBe('world')
  })
})

describe('reading the tree', () => {
  const tree: Plate[] = [{
    slug: 'world',
    title: 'World',
    subtitle: 'everywhere, all of it',
    bbox: [-180, -85, 180, 85],
    entryPack: 'philosophy',
    packs: ['philosophy'],
    children: [{
      slug: 'india',
      title: 'India',
      subtitle: 'the subcontinent, kingdom by kingdom',
      bbox: [66, 5, 97.6, 37.6],
      entryPack: 'creatures',
      packs: ['creatures', 'mythology'],
      children: [{
        slug: 'north-india',
        title: 'Northern India',
        subtitle: 'the Ganges plain',
        bbox: [72, 22, 90, 32],
        entryPack: 'mythology',
        packs: ['mythology'],
        children: [],
      }],
    }],
  }]

  it('finds a plate at any depth', () => {
    expect(findPlate(tree, 'north-india')?.title).toBe('Northern India')
    expect(findPlate(tree, 'atlantis')).toBeNull()
  })

  it('names the plate one is drawn inside, and nothing above a root', () => {
    expect(parentOfPlate(tree, 'india')?.slug).toBe('world')
    expect(parentOfPlate(tree, 'north-india')?.slug).toBe('india')
    expect(parentOfPlate(tree, 'world')).toBeNull()
  })

  it('names the plates drawn inside one', () => {
    expect(childrenOfPlate(tree, 'world').map((p) => p.slug)).toEqual(['india'])
    expect(childrenOfPlate(tree, 'north-india')).toEqual([])
    expect(childrenOfPlate(tree, 'atlantis')).toEqual([])
  })

  it('flattens in reading order, carrying how deep each sits', () => {
    // Which is what the menu indents by. A third level costs it nothing, and
    // nothing authors one yet.
    expect(flattenPlates(tree).map(({ plate, depth }) => [plate.slug, depth]))
      .toEqual([['world', 0], ['india', 1], ['north-india', 2]])
  })
})

describe('keeping the reader\'s pack across a change of scale', () => {
  const india: Plate = {
    slug: 'india',
    title: 'India',
    subtitle: 'the subcontinent, kingdom by kingdom',
    bbox: [66, 5, 97.6, 37.6],
    entryPack: 'creatures',
    packs: ['creatures', 'mythology'],
    children: [],
  }

  it('keeps the pack the reader is reading when the plate offers it', () => {
    expect(entryPackFor(india, 'mythology')).toBe('mythology')
    expect(plateHref(india, 'mythology')).toBe('/india/mythology')
  })

  it('falls back to the plate\'s own first pack when it does not', () => {
    expect(entryPackFor(india, 'philosophy')).toBe('creatures')
    expect(plateHref(india, 'philosophy')).toBe('/india/creatures')
  })
})
