import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { entities, eraSets, packs, regions } from '../db/schema'

/** A pack as the landing page offers it. */
export interface AtlasIndexPack {
  slug: string
  title: string
  subtitle: string
  /** How many figures are in it. A link with no weight is easy to ignore. */
  entityCount: number
}

/** A region, with the packs laid over it. */
export interface AtlasIndexRegion {
  slug: string
  title: string
  subtitle: string
  /** Never empty — a region with no published pack is not listed at all. */
  packs: AtlasIndexPack[]
}

/**
 * Every atlas that will actually render, grouped by the map it is drawn on.
 *
 * A flat list of packs was the right shape while each one was its own page.
 * They are not: a pack is a choice made inside a region, switchable from the
 * header, so what the reader picks here is which *map* to open and which pack
 * to open it on. The grouping says that before they arrive.
 *
 * Joined through `era_sets`, the only row in the schema that says "this pack
 * has been placed on this region" — `packs` carries no region column, because
 * a pack is not owned by a region. `src/read/regionPacks.ts` reads the same
 * relationship for the switcher itself.
 *
 * Both `isNotNull` filters keep the list honest: they are exactly the
 * conditions `app/[region]/[pack]/page.tsx` needs to avoid a 404. A region
 * whose packs are all unpublished drops out with them, because a region is
 * only reachable through a pack — there is no `/<region>` route to send anyone
 * to, and a heading with nothing under it is not an offer.
 *
 * No slug is named here, and none may be (Rules 2 and 3).
 */
export async function publishedAtlases(): Promise<AtlasIndexRegion[]> {
  const rows = await db
    .select({
      regionSlug: regions.slug,
      regionTitle: regions.title,
      regionSubtitle: regions.subtitle,
      packSlug: packs.slug,
      packTitle: packs.title,
      packSubtitle: packs.subtitle,
      packEntities: sql<number>`(
        select count(*)::int from ${entities} where ${entities.packId} = ${packs.id}
      )`,
    })
    .from(eraSets)
    .innerJoin(regions, eq(eraSets.regionId, regions.id))
    .innerJoin(packs, eq(eraSets.packId, packs.id))
    .where(and(isNotNull(regions.currentArtifactKey), isNotNull(packs.currentVersionId)))
    .orderBy(asc(regions.title), asc(packs.title))

  // One pass, relying on the ORDER BY above: rows for a region arrive together
  // and in the order they should be offered, so grouping is a lookup rather
  // than a sort of its own.
  const byRegion = new Map<string, AtlasIndexRegion>()
  for (const row of rows) {
    let entry = byRegion.get(row.regionSlug)
    if (!entry) {
      entry = {
        slug: row.regionSlug,
        title: row.regionTitle,
        subtitle: row.regionSubtitle,
        packs: [],
      }
      byRegion.set(row.regionSlug, entry)
    }
    entry.packs.push({
      slug: row.packSlug,
      title: row.packTitle,
      subtitle: row.packSubtitle,
      entityCount: row.packEntities,
    })
  }

  return [...byRegion.values()]
}
