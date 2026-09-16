import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { layers } from '../db/schema'
import { deleteAllLayers } from '../db/testSeed'
import { importLayers } from '../../scripts/import-layers'
import { publishLayer } from './publishLayer'
import { memoryStorage } from './storage'

describe('publishLayer', () => {
  let id: string

  beforeAll(async () => {
    await deleteAllLayers()
    await importLayers()
    const [row] = await db.select({ id: layers.id }).from(layers)
      .where(eq(layers.slug, 'buddhism'))
    id = row.id
  })

  it('writes a content-hashed object and moves the pointer', async () => {
    const storage = memoryStorage()
    const { key } = await publishLayer(id, storage)

    expect(key).toMatch(/^layers\/buddhism\/[0-9a-f]{16}\.json$/)
    expect(storage.objects.has(key)).toBe(true)

    const [row] = await db.select({ key: layers.currentArtifactKey }).from(layers)
      .where(eq(layers.id, id))
    expect(row.key).toBe(key)
  })

  it('writes the same key for unchanged content', async () => {
    const first = await publishLayer(id, memoryStorage())
    const second = await publishLayer(id, memoryStorage())
    expect(second.key).toBe(first.key)
  })
})
