import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { layers, regions } from '../db/schema'
import { deleteAllLayers, seedWorldAndPacks } from '../db/testSeed'
import { importLayers } from '../../scripts/import-layers'
import { publishLayer } from '../publish/publishLayer'
import { memoryStorage } from '../publish/storage'
import { layersOnRegion } from './regionLayers'

describe('layersOnRegion', () => {
  beforeAll(async () => {
    await seedWorldAndPacks()
    // seedWorldAndPacks imports the world region but never publishes it, so
    // current_artifact_key is null coming out of it. layersOnRegion now
    // requires the region to carry one (mirroring packsOnRegion), so the
    // fixture has to set it — a literal key, not a real publish, is enough:
    // nothing here reads the region artifact itself.
    await db.update(regions).set({ currentArtifactKey: 'regions/world/deadbeef.json' })
      .where(eq(regions.slug, 'world'))
    await deleteAllLayers()
    await importLayers()
    for (const row of await db.select({ id: layers.id }).from(layers)) {
      await publishLayer(row.id, memoryStorage())
    }
  })

  it('offers every published layer that touches the region', async () => {
    const offered = await layersOnRegion('world')
    expect(offered.map((layer) => layer.slug).sort()).toContain('silk-road')
    expect(offered).toHaveLength(9)
  })

  it('carries the artifact url and an inclusive period', async () => {
    const [silk] = (await layersOnRegion('world')).filter((l) => l.slug === 'silk-road')
    expect(silk.artifactUrl).toMatch(/\/layers\/silk-road\/[0-9a-f]{16}\.json$/)
    expect(silk.valid).toEqual({ start: -130, end: 1450 })
    expect(silk.paletteSlot).toBe(1)
  })

  it('leaves out a layer that has never been published', async () => {
    const [row] = await db.insert(layers).values({
      slug: 'unpublished-road', name: 'Unpublished Road', kind: 'trade', paletteSlot: 9,
      valid: [0, 100], note: 'Imported and never published.',
      visibility: 'official', status: 'published',
    }).returning()
    // Give it geometry inside the world bbox so only the missing pointer can
    // be what excludes it.
    await db.execute(sql`
      insert into layer_features (layer_id, name, geom)
      values (${row.id}, 'leg', ST_SetSRID(ST_Multi(ST_GeomFromText('LINESTRING(0 0, 5 5)')), 4326))
    `)

    const offered = await layersOnRegion('world')
    expect(offered.map((layer) => layer.slug)).not.toContain('unpublished-road')

    await db.delete(layers).where(eq(layers.id, row.id))
  })

  it('leaves out a layer whose geometry falls outside the region', async () => {
    const [region] = await db.insert(regions).values({
      slug: 'test-strip', title: 'Test Strip', subtitle: 'A narrow region',
      bbox: 'SRID=4326;POLYGON((100 0, 110 0, 110 10, 100 10, 100 0))',
      defaultCamera: { center: [105, 5], zoom: 3 },
      range: [0, 1000], theme: 'rustic', currentArtifactKey: 'regions/test-strip/deadbeef.json',
    }).returning()

    // The Atlantic passage does not reach 100E to 110E.
    const offered = await layersOnRegion('test-strip')
    expect(offered.map((layer) => layer.slug)).not.toContain('atlantic-passage')

    await db.delete(regions).where(eq(regions.id, region.id))
  })
  it('leaves out a layer that is not in published status, whatever its pointer says', async () => {
    // The pointer and the status are two columns, and nothing keeps them in
    // step: publishing sets the pointer and never touches the status. A layer
    // moved back to draft keeps its key, so the key alone would still offer it.
    const [row] = await db.insert(layers).values({
      slug: 'drafted-road', name: 'Drafted Road', kind: 'trade', paletteSlot: 9,
      valid: [0, 100], note: 'Published once, then moved back to draft.',
      visibility: 'official', status: 'draft',
      currentArtifactKey: 'layers/drafted-road/deadbeef.json',
    }).returning()
    await db.execute(sql`
      insert into layer_features (layer_id, name, geom)
      values (${row.id}, 'leg', ST_SetSRID(ST_Multi(ST_GeomFromText('LINESTRING(0 0, 5 5)')), 4326))
    `)
    try {
      const offered = await layersOnRegion('world')
      expect(offered.map((layer) => layer.slug)).not.toContain('drafted-road')
    } finally {
      await db.delete(layers).where(eq(layers.id, row.id))
    }
  })

  it('breaks a tie on palette slot with the slug', async () => {
    // Inserted after the Silk Road and sharing its slot, so row order and slug
    // order disagree and a sort on the slot alone is free to return either.
    const [row] = await db.insert(layers).values({
      slug: 'aaa-road', name: 'Aaa Road', kind: 'trade', paletteSlot: 1,
      valid: [0, 100], note: 'Shares the Silk Road slot on purpose.',
      visibility: 'official', status: 'published',
      currentArtifactKey: 'layers/aaa-road/deadbeef.json',
    }).returning()
    await db.execute(sql`
      insert into layer_features (layer_id, name, geom)
      values (${row.id}, 'leg', ST_SetSRID(ST_Multi(ST_GeomFromText('LINESTRING(0 0, 5 5)')), 4326))
    `)
    try {
      const slots = (await layersOnRegion('world')).filter((layer) => layer.paletteSlot === 1)
      expect(slots.map((layer) => layer.slug)).toEqual(['aaa-road', 'silk-road'])
    } finally {
      await db.delete(layers).where(eq(layers.id, row.id))
    }
  })
})
