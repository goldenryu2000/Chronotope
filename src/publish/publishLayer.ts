import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { layers } from '../db/schema'
import { artifactKey, hashArtifact } from './hash'
import { renderLayer } from './renderLayer'
import type { Storage } from './storage'

/**
 * Publishes a layer, the way `publishRegion` publishes a region.
 *
 * A bare pointer, not a versions table: nothing addresses a specific version
 * of a layer. A tour stop names a slug and resolution happens at read time, so
 * republishing a layer changes what an already-shared tour link draws — which
 * is the intended behaviour, since a corrected route should reach every reader
 * rather than only new ones. Tours are the opposite case and carry versions.
 */
export async function publishLayer(layerId: string, storage: Storage) {
  const artifact = await renderLayer(layerId)
  const hash = hashArtifact(artifact)
  const key = artifactKey('layers', artifact.id, hash)

  await storage.put(key, JSON.stringify(artifact), 'application/json')
  await db.update(layers).set({ currentArtifactKey: key }).where(eq(layers.id, layerId))
  return { key }
}
