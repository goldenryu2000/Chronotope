import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { packVersions, packs, regions } from '../db/schema'

/**
 * Resolved on the server so the browser makes one request, not two. The old
 * build fetched a manifest to discover the entities file, which cost a round
 * trip before anything could render.
 */
export async function currentArtifactUrl(
  kind: 'packs' | 'regions',
  slug: string,
): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_ARTIFACT_BASE_URL
  if (!base) throw new Error('NEXT_PUBLIC_ARTIFACT_BASE_URL is not set')

  const key = kind === 'packs' ? await packKey(slug) : await regionKey(slug)
  return key ? `${base}/${key}` : null
}

async function packKey(slug: string): Promise<string | null> {
  const [row] = await db.select({ key: packVersions.artifactKey })
    .from(packs)
    .innerJoin(packVersions, eq(packs.currentVersionId, packVersions.id))
    .where(eq(packs.slug, slug))
    .limit(1)
  return row?.key ?? null
}

async function regionKey(slug: string): Promise<string | null> {
  const [row] = await db.select({ key: regions.currentArtifactKey })
    .from(regions)
    .where(and(eq(regions.slug, slug), isNotNull(regions.currentArtifactKey)))
    .limit(1)
  return row?.key ?? null
}
