import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { entities, eraSets, packVersions, packs, regions } from '../db/schema'

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
 * A pack with nobody inside the region is left out, which is the rule a
 * regional atlas adds. A plate draws the figures that stand on it, so a pack
 * whose every figure is somewhere else would be a switcher entry that empties
 * the map. On `world` the bbox is the world, so nothing changes there; on a
 * plate the size of a subcontinent it is the difference between three honest
 * doors and three doors of which two open onto nothing.
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
    .where(and(
      eq(regions.slug, regionSlug),
      isNotNull(regions.currentArtifactKey),
      sql`exists (
        select 1 from ${entities} e
        where e.pack_id = ${packs.id} and e.point && ${regions.bbox}
      )`,
    ))
    .orderBy(asc(packs.title))

  return rows.map(({ key, ...pack }) => ({ ...pack, artifactUrl: `${base}/${key}` }))
}
