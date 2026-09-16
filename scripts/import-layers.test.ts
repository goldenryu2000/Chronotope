import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { layerFeatures, layers, users } from '../src/db/schema'
import { deleteAllLayers } from '../src/db/testSeed'
import { importLayers } from './import-layers'

const layerFile = (id: string, period: [number, number]) => ({
  id,
  name: 'A Road',
  kind: 'trade',
  paletteSlot: 1,
  valid: { start: period[0], end: period[1] },
  note: 'Written by this suite and read by nothing else.',
  features: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Only leg' },
        geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
      },
    ],
  },
})

describe('importLayers', () => {
  let dir: string

  beforeEach(async () => {
    await deleteAllLayers()
    dir = await mkdtemp(join(tmpdir(), 'layers-'))
  })

  it('stores the period end-exclusive', async () => {
    await writeFile(join(dir, 'a-road.json'), JSON.stringify(layerFile('a-road', [-130, 1450])))
    await importLayers(dir)

    const [row] = await db.select({ valid: layers.valid }).from(layers)
      .where(eq(layers.slug, 'a-road'))
    // The file says the road is in use through 1450, inclusive. int4range is
    // end-exclusive, so the column holds 1451.
    expect(row.valid).toEqual([-130, 1451])
  })

  it('stores each leg as SRID 4326 MultiLineString', async () => {
    await writeFile(join(dir, 'a-road.json'), JSON.stringify(layerFile('a-road', [0, 100])))
    await importLayers(dir)

    const [row] = await db
      .select({
        name: layerFeatures.name,
        type: sql<string>`ST_GeometryType(${layerFeatures.geom})`,
        srid: sql<number>`ST_SRID(${layerFeatures.geom})`,
      })
      .from(layerFeatures)
    expect(row.name).toBe('Only leg')
    expect(row.type).toBe('ST_MultiLineString')
    expect(row.srid).toBe(4326)
  })

  it('replaces a layer rather than doubling its legs', async () => {
    await writeFile(join(dir, 'a-road.json'), JSON.stringify(layerFile('a-road', [0, 100])))
    await importLayers(dir)
    await importLayers(dir)

    expect(await db.select().from(layerFeatures)).toHaveLength(1)
  })

  it('refuses two layers sharing a palette slot', async () => {
    await writeFile(join(dir, 'a-road.json'), JSON.stringify(layerFile('a-road', [0, 100])))
    await writeFile(join(dir, 'b-road.json'), JSON.stringify(layerFile('b-road', [0, 100])))
    await expect(importLayers(dir)).rejects.toThrow(/palette slot 1/)
  })
  it('re-publishes a layer that was moved to draft, because the file says so', async () => {
    await writeFile(join(dir, 'a-road.json'), JSON.stringify(layerFile('a-road', [0, 100])))
    await importLayers(dir)
    await db.update(layers).set({ status: 'draft' }).where(eq(layers.slug, 'a-road'))

    await importLayers(dir)

    const [row] = await db.select().from(layers).where(eq(layers.slug, 'a-road'))
    expect(row.status).toBe('published')
    expect(row.visibility).toBe('official')
  })

  it("refuses to overwrite a reader's own layer that shares a slug", async () => {
    const [reader] = await db.insert(users)
      .values({ handle: 'import-probe-reader', displayName: 'Probe Reader' }).returning()
    try {
      await db.insert(layers).values({
        slug: 'a-road', name: 'Their Road', kind: 'trade', paletteSlot: 2,
        valid: [0, 101], note: "A reader's own road, which no import may touch.",
        ownerId: reader.id, visibility: 'community', status: 'draft',
      })
      await writeFile(join(dir, 'a-road.json'), JSON.stringify(layerFile('a-road', [0, 100])))

      await expect(importLayers(dir)).rejects.toThrow(/belongs to a reader/)

      const [row] = await db.select().from(layers).where(eq(layers.slug, 'a-road'))
      expect(row.name).toBe('Their Road')
      expect(row.ownerId).toBe(reader.id)
    } finally {
      await deleteAllLayers()
      await db.delete(users).where(eq(users.id, reader.id))
    }
  })

  it('refuses a point outside the world', async () => {
    const file = layerFile('a-road', [0, 100])
    file.features.features[0].geometry.coordinates = [[0, 0], [200, 10]]
    await writeFile(join(dir, 'a-road.json'), JSON.stringify(file))

    await expect(importLayers(dir)).rejects.toThrow(/outside the world at 200, 10/)
  })

  it('refuses a leg that crosses the antimeridian, and writes nothing', async () => {
    // Written the way a crossing leg naturally is: 174 east, then 172 west.
    const file = layerFile('a-road', [0, 100])
    file.features.features[0].geometry.coordinates = [[174, -15], [-172, -14]]
    await writeFile(join(dir, 'a-road.json'), JSON.stringify(file))

    await expect(importLayers(dir)).rejects.toThrow(/crosses the antimeridian/)
    expect(await db.select().from(layers).where(eq(layers.slug, 'a-road'))).toHaveLength(0)
  })
})
