import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { packVersions, packs, regions } from '../db/schema'
import { artifactKey, hashArtifact } from './hash'
import { renderPack } from './renderPack'
import { renderRegion } from './renderRegion'
import type { Storage } from './storage'

export async function publishPack(packId: string, storage: Storage) {
  const artifact = await renderPack(packId) // throws if invalid
  const hash = hashArtifact(artifact)
  const key = artifactKey('packs', artifact.id, hash)

  // Object storage is not transactional, and that is fine here: keys are
  // content-hashed, so an object written but never referenced by a
  // pack_versions row is harmless — it just sits there under a key nothing
  // points at. The two database statements below are the part that must be
  // atomic (a version row with no matching pointer update would be an
  // orphan), so only they run inside `db.transaction`.
  await storage.put(key, JSON.stringify(artifact), 'application/json')

  const { key: publishedKey, version } = await db.transaction(async (tx) => {
    // Read-then-write: two concurrent publishes of the same pack could both
    // read the same max(version) and race to insert the same next version.
    // `pack_version_unique` (pack_id, version) makes the loser's insert fail
    // loudly instead of corrupting the version sequence. A single-maintainer,
    // synchronous publish flow doesn't need real locking to close that gap.
    const [previous] = await tx.select().from(packVersions)
      .where(eq(packVersions.packId, packId))
      .orderBy(desc(packVersions.version))
      .limit(1)
    const nextVersion = (previous?.version ?? 0) + 1

    const [row] = await tx.insert(packVersions)
      .values({ packId, version: nextVersion, artifactKey: key, artifactHash: hash })
      .returning()

    await tx.update(packs).set({ currentVersionId: row.id }).where(eq(packs.id, packId))

    return { key, version: nextVersion }
  })

  return { key: publishedKey, version }
}

export async function publishRegion(regionId: string, storage: Storage) {
  const artifact = await renderRegion(regionId)
  const hash = hashArtifact(artifact)
  const key = artifactKey('regions', artifact.id, hash)

  await storage.put(key, JSON.stringify(artifact), 'application/json')
  await db.update(regions).set({ currentArtifactKey: key }).where(eq(regions.id, regionId))
  return { key }
}
