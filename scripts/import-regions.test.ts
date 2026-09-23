import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { eraSets, eras, packs, regions } from '../src/db/schema'
import { importPack, LEGACY_CONTENT_DIR } from './import-legacy'
import { importRegions, orderByDepth, readRegionDefinitions } from './import-regions'
import type { RegionDefinition } from '../src/data/schemas'

/** A definition with the required fields filled in, for the ordering tests. */
function def(id: string, parent: string | null): RegionDefinition {
  return {
    id,
    title: id,
    subtitle: id,
    parent,
    bbox: [0, 0, 10, 10],
    minZoom: 0,
    maxZoom: 6,
    defaultCamera: { center: [5, 5], zoom: 3 },
    range: { start: -100, end: 100 },
    theme: 'rustic',
    packs: [],
    eras: [{
      id: 'only', label: 'Only', start: -100, end: 100, weight: 1,
      blurb: 'One era, which is the fewest a region may have and still draw a timeline.',
    }],
  }
}

const byId = (...list: RegionDefinition[]) => new Map(list.map((d) => [d.id, d]))

describe('the committed region definitions', () => {
  it('all parse, so the repository cannot ship a region the importer will refuse', () => {
    // The files themselves, not a fixture: the contract is only worth having if
    // what is committed satisfies it, and every refinement in
    // `RegionDefinitionSchema` is an assertion about these two files.
    const found = readRegionDefinitions()
    expect([...found.keys()].sort()).toEqual(['india', 'world'])
  })

  it('has exactly one root, and it is the plate everything else sits in', () => {
    const found = readRegionDefinitions()
    const roots = [...found.values()].filter((region) => region.parent === null)
    expect(roots.map((region) => region.id)).toEqual(['world'])
  })

  it('draws india inside the world it names as its parent', () => {
    const found = readRegionDefinitions()
    const india = found.get('india') as RegionDefinition
    const world = found.get('world') as RegionDefinition
    expect(india.bbox[0]).toBeGreaterThanOrEqual(world.bbox[0])
    expect(india.bbox[1]).toBeGreaterThanOrEqual(world.bbox[1])
    expect(india.bbox[2]).toBeLessThanOrEqual(world.bbox[2])
    expect(india.bbox[3]).toBeLessThanOrEqual(world.bbox[3])
  })

  it('gives india a deeper archive than the world, which is the point of a plate', () => {
    const found = readRegionDefinitions()
    expect((found.get('india') as RegionDefinition).maxZoom)
      .toBeGreaterThan((found.get('world') as RegionDefinition).maxZoom)
  })

  it('gives india its own periodization rather than the world default', () => {
    const found = readRegionDefinitions()
    const india = (found.get('india') as RegionDefinition).eras.map((era) => era.id)
    const world = (found.get('world') as RegionDefinition).eras.map((era) => era.id)
    expect(india).not.toEqual(world)
    // And no pack override on it, so the plate's own centuries drive the track.
    for (const entry of (found.get('india') as RegionDefinition).packs) {
      expect(entry.eras).toEqual([])
    }
  })
})

describe('orderByDepth', () => {
  it('puts a parent before the plates drawn inside it', () => {
    const ordered = orderByDepth(byId(def('inner', 'outer'), def('outer', null)))
    expect(ordered.map((region) => region.id)).toEqual(['outer', 'inner'])
  })

  it('handles a third level, which the schema permits and nothing authors yet', () => {
    const ordered = orderByDepth(byId(
      def('north', 'india'), def('india', 'world'), def('world', null),
    ))
    expect(ordered.map((region) => region.id)).toEqual(['world', 'india', 'north'])
  })

  it('refuses a parent no file defines, naming both regions', () => {
    expect(() => orderByDepth(byId(def('india', 'atlantis'))))
      .toThrow(/india[\s\S]*atlantis/)
  })

  it('refuses a cycle rather than recursing until the stack runs out', () => {
    expect(() => orderByDepth(byId(def('a', 'b'), def('b', 'a')))).toThrow(/cycle/)
  })
})

describe('importRegions', () => {
  beforeAll(async () => {
    await db.delete(regions)
    await db.delete(packs)
    // Packs first, the order the cold start runs in: a region file names the
    // packs laid over it and only places one that exists.
    for (const slug of ['philosophy', 'mythology', 'creatures']) {
      await importPack(`${LEGACY_CONTENT_DIR}/${slug}`)
    }
    await importRegions()
  })

  it('writes both committed regions', async () => {
    const rows = await db.select({ slug: regions.slug }).from(regions)
    expect(rows.map((row) => row.slug).sort()).toEqual(['india', 'world'])
  })

  it('links india to the world through parent_id, and leaves the world a root', async () => {
    const [world] = await db.select().from(regions).where(eq(regions.slug, 'world'))
    const [india] = await db.select().from(regions).where(eq(regions.slug, 'india'))
    expect(world.parentId).toBeNull()
    expect(india.parentId).toBe(world.id)
  })

  it('gives each region a default era set of its own', async () => {
    for (const slug of ['world', 'india']) {
      const [row] = await db.select().from(regions).where(eq(regions.slug, slug))
      const sets = await db.select().from(eraSets).where(eq(eraSets.regionId, row.id))
      const defaults = sets.filter((set) => set.packId === null)
      expect(defaults).toHaveLength(1)
      const rows = await db.select().from(eras).where(eq(eras.eraSetId, defaults[0].id))
      expect(rows.length).toBeGreaterThan(0)
    }
  })

  it('lays every declared pack over the region', async () => {
    const [india] = await db.select().from(regions).where(eq(regions.slug, 'india'))
    const rows = await db
      .select({ pack: packs.slug })
      .from(eraSets)
      .innerJoin(packs, eq(eraSets.packId, packs.id))
      .where(eq(eraSets.regionId, india.id))
    expect(rows.map((row) => row.pack).sort()).toEqual(['creatures', 'mythology', 'philosophy'])
  })

  it('keeps the myth packs\' own periodization on the world, as an override', async () => {
    // This is the behaviour that used to live in `import-legacy.ts`. The world
    // atlas's timeline for the gods runs on six eras, not the region's eleven,
    // and moving where placement is written must not have moved that.
    const [world] = await db.select().from(regions).where(eq(regions.slug, 'world'))
    const [pack] = await db.select().from(packs).where(eq(packs.slug, 'mythology'))
    const [set] = await db.select().from(eraSets)
      .where(sql`${eraSets.regionId} = ${world.id} and ${eraSets.packId} = ${pack.id}`)
    const rows = await db.select().from(eras).where(eq(eras.eraSetId, set.id))
    expect(rows).toHaveLength(6)
  })

  it('places a pack on india with no override, so the plate\'s own eras drive the track', async () => {
    const [india] = await db.select().from(regions).where(eq(regions.slug, 'india'))
    const [pack] = await db.select().from(packs).where(eq(packs.slug, 'mythology'))
    const [set] = await db.select().from(eraSets)
      .where(sql`${eraSets.regionId} = ${india.id} and ${eraSets.packId} = ${pack.id}`)
    const rows = await db.select().from(eras).where(eq(eras.eraSetId, set.id))
    expect(rows).toEqual([])
  })

  it('is idempotent: a second run leaves one row per region and no duplicate eras', async () => {
    await importRegions()
    const rows = await db.select({ slug: regions.slug }).from(regions)
    expect(rows.map((row) => row.slug).sort()).toEqual(['india', 'world'])

    const [india] = await db.select().from(regions).where(eq(regions.slug, 'india'))
    const sets = await db.select().from(eraSets).where(eq(eraSets.regionId, india.id))
    expect(sets.filter((set) => set.packId === null)).toHaveLength(1)
  })

  it('brings a named region\'s ancestors, because parent_id is a foreign key', async () => {
    await db.delete(regions)
    const results = await importRegions(['india'])
    expect(results.map((result) => result.slug)).toEqual(['world', 'india'])
  })

  it('reports a pack it cannot find rather than throwing, and places the rest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chronotope-regions-'))
    writeFileSync(join(dir, 'fixture.json'), JSON.stringify({
      ...def('fixture-plate', null),
      packs: ['philosophy', 'no-such-pack'],
    }))

    const [result] = await importRegions(['fixture-plate'], dir)
    expect(result.packs).toEqual(['philosophy'])
    expect(result.missingPacks).toEqual(['no-such-pack'])

    await db.delete(regions).where(eq(regions.slug, 'fixture-plate'))
  })

  it('refuses a file that is not a region definition, naming the file and the field', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chronotope-regions-'))
    writeFileSync(join(dir, 'broken.json'), JSON.stringify({
      ...def('broken-plate', null),
      // Opens outside its own edges, which with `maxBounds` set from the same
      // bbox is a blank map the camera cannot travel back from.
      defaultCamera: { center: [99, 99], zoom: 3 },
    }))

    await expect(importRegions(['broken-plate'], dir))
      .rejects.toThrow(/broken\.json[\s\S]*bbox/)
  })
})
