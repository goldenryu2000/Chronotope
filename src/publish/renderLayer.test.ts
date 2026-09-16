import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { layers } from '../db/schema'
import { deleteAllLayers } from '../db/testSeed'
import { importLayers } from '../../scripts/import-layers'
import { renderLayer } from './renderLayer'

describe('renderLayer', () => {
  let silkRoadId: string
  let buddhismId: string

  beforeAll(async () => {
    await deleteAllLayers()
    await importLayers()
    const [silkRoad] = await db.select({ id: layers.id }).from(layers)
      .where(eq(layers.slug, 'silk-road'))
    silkRoadId = silkRoad.id
    const [buddhism] = await db.select({ id: layers.id }).from(layers)
      .where(eq(layers.slug, 'buddhism'))
    buddhismId = buddhism.id
  })

  it('renders slugs and an inclusive period', async () => {
    const layer = await renderLayer(silkRoadId)
    expect(layer.id).toBe('silk-road')
    expect(layer.kind).toBe('trade')
    // The column holds 1451 end-exclusive; the artifact says 1450.
    expect(layer.valid.end).toBe(1450)
  })

  it('renders every leg as a named feature', async () => {
    const layer = await renderLayer(silkRoadId)
    expect(layer.features.type).toBe('FeatureCollection')
    expect(layer.features.features.length).toBeGreaterThan(1)
    for (const feature of layer.features.features) {
      expect(typeof feature.properties?.name).toBe('string')
    }
  })

  it('refuses a layer id that does not exist', async () => {
    await expect(renderLayer('00000000-0000-0000-0000-000000000000')).rejects.toThrow(/no such layer/)
  })

  // `hashArtifact` sorts object keys but not array elements, so the order
  // features come back in is load-bearing for hash stability, not cosmetic.
  // `data/layers/buddhism.json` stores its legs as "Northern transmission",
  // "To Korea and Japan", "Southern transmission" — not alphabetical — so
  // this catches a dropped `ORDER BY` directly, rather than relying on two
  // publishes in one process happening to see the same row order back.
  it('orders features alphabetically by name, not by how the source stored them', async () => {
    const layer = await renderLayer(buddhismId)
    const names = layer.features.features.map((feature) => feature.properties?.name)
    expect(names).toEqual(['Northern transmission', 'Southern transmission', 'To Korea and Japan'])
  })
  it('orders two legs that share a name by their geometry, so a re-import keeps the hash', async () => {
    // Names are not unique within a layer. Written in one order and then the
    // other, the same two legs must render identically, or republishing
    // unchanged content mints a new artifact.
    const leg = (coordinates: number[][]) => ({
      type: 'Feature', properties: { name: 'Same' }, geometry: { type: 'LineString', coordinates },
    })
    const east = leg([[30, 10], [40, 20]])
    const west = leg([[-30, 10], [-40, 20]])
    const file = (features: unknown[]) => JSON.stringify({
      id: 'twin-road', name: 'Twin Road', kind: 'trade', paletteSlot: 8,
      valid: { start: 0, end: 100 },
      note: 'Two legs with one name, written by this suite.',
      features: { type: 'FeatureCollection', features },
    })

    const dir = await mkdtemp(join(tmpdir(), 'layers-'))
    try {
      await writeFile(join(dir, 'twin-road.json'), file([east, west]))
      await importLayers(dir)
      const [row] = await db.select({ id: layers.id }).from(layers).where(eq(layers.slug, 'twin-road'))
      const first = await renderLayer(row.id)

      await writeFile(join(dir, 'twin-road.json'), file([west, east]))
      await importLayers(dir)
      const second = await renderLayer(row.id)

      expect(second.features).toEqual(first.features)
    } finally {
      await db.delete(layers).where(eq(layers.slug, 'twin-road'))
    }
  })
})
