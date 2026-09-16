import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { packVersions, packs } from '../db/schema'
import { PackSchema } from '../data/schemas'
import { memoryStorage } from './storage'
import { publishPack } from './publishPack'
import { renderPack } from './renderPack'

let packId: string

describe('publishPack', () => {
  beforeAll(async () => {
    const [row] = await db.select().from(packs).where(eq(packs.slug, 'philosophy'))
    packId = row.id
    await db.delete(packVersions).where(eq(packVersions.packId, packId))
  })

  it('writes an artifact and advances the current pointer', async () => {
    const storage = memoryStorage()
    const { key, version } = await publishPack(packId, storage)

    expect(version).toBe(1)
    expect(storage.objects.has(key)).toBe(true)

    // Not just that something was written under the key, but that it is the
    // artifact that was rendered — parsed back through the same contract the
    // read path trusts.
    const stored = PackSchema.parse(JSON.parse(storage.objects.get(key)!))
    expect(stored).toEqual(await renderPack(packId))

    const [pack] = await db.select().from(packs).where(eq(packs.id, packId))
    const [live] = await db.select().from(packVersions)
      .where(eq(packVersions.id, pack.currentVersionId!))
    expect(live.artifactKey).toBe(key)
  })

  it('republishing unchanged content reuses the same key but bumps the version', async () => {
    const storage = memoryStorage()
    const first = await publishPack(packId, storage)
    const second = await publishPack(packId, storage)
    expect(second.key).toBe(first.key)
    expect(second.version).toBe(first.version + 1)
  })
})
