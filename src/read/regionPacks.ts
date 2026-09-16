import { and, asc, eq, isNotNull } from 'drizzle-orm'
import { db } from '../db/client'
import { eraSets, packVersions, packs, regions } from '../db/schema'

/** One entry in the pack switcher, resolved on the server. */
export interface RegionPack {
  slug: string
  title: string
  subtitle: string
  /** The immutable artifact, so the client can switch without a round trip. */
  artifactUrl: string
}

/**
 * Every published pack laid over a region, in the order they should be offered.
 *
 * Joined through `era_sets`, which is the only row in the schema that says
 * "this pack has been placed on this region" — `packs` carries no region
 * column, because a pack is not owned by a region. The null-`pack_id` rows, a
 * region's own default periodization, drop out of the inner join on their own.
 * `app/page.tsx` reads the same relationship for the landing list.
 *
 * The `isNotNull` filter is what keeps the switcher honest: it is exactly the
 * condition `app/[region]/[pack]/page.tsx` needs to avoid a 404, so a pack
 * imported but never published is left out rather than offered as a dead end.
 *
 * No slug is named here, and none may be. A fourth pack, or somebody's own,
 * appears in the switcher on its next publish with no change to this file.
 */
export async function packsOnRegion(regionSlug: string): Promise<RegionPack[]> {
  const base = process.env.NEXT_PUBLIC_ARTIFACT_BASE_URL
  if (!base) throw new Error('NEXT_PUBLIC_ARTIFACT_BASE_URL is not set')

  const rows = await db
    .select({
      slug: packs.slug,
      title: packs.title,
      subtitle: packs.subtitle,
      key: packVersions.artifactKey,
    })
    .from(eraSets)
    .innerJoin(regions, eq(eraSets.regionId, regions.id))
    .innerJoin(packs, eq(eraSets.packId, packs.id))
    .innerJoin(packVersions, eq(packs.currentVersionId, packVersions.id))
    .where(and(eq(regions.slug, regionSlug), isNotNull(regions.currentArtifactKey)))
    .orderBy(asc(packs.title))

  return rows.map(({ key, ...pack }) => ({ ...pack, artifactUrl: `${base}/${key}` }))
}
