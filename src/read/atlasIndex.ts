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

/** A region, with the packs laid over it and the plates drawn inside it. */
export interface AtlasIndexRegion {
  slug: string
  title: string
  subtitle: string
  /** Never empty — a region with no published pack is not listed at all. */
  packs: AtlasIndexPack[]
  /**
   * Plates drawn inside this one, same shape, nested.
   *
   * Nested rather than listed flat, and the reason is the reader rather than
   * the schema: "India" beside "World" reads as an alternative, and it is not
   * one. It is a closer look at part of the same map, and the only honest way
   * to say so in a list is to put it under the thing it is part of.
   *
   * Recursive, so a third level costs this file nothing. Nothing authors one
   * yet, which is the right amount of hierarchy to have built.
   */
  children: AtlasIndexRegion[]
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
      regionId: regions.id,
      regionParentId: regions.parentId,
      regionSlug: regions.slug,
      regionTitle: regions.title,
      regionSubtitle: regions.subtitle,
      packSlug: packs.slug,
      packTitle: packs.title,
      packSubtitle: packs.subtitle,
      // Counted inside the region's own bbox, not across the pack. A plate
      // draws the figures that stand on it, so "81 figures" on a plate that
      // shows ten is a promise the map does not keep. On `world` the bbox is
      // the world and the count is unchanged.
      packEntities: sql<number>`(
        select count(*)::int from ${entities}
        where ${entities.packId} = ${packs.id} and ${entities.point} && ${regions.bbox}
      )`,
    })
    .from(eraSets)
    .innerJoin(regions, eq(eraSets.regionId, regions.id))
    .innerJoin(packs, eq(eraSets.packId, packs.id))
    .where(and(isNotNull(regions.currentArtifactKey), isNotNull(packs.currentVersionId)))
    // Roots before the plates inside them, so the grouping pass below always
    // meets a parent before its child and the hero on the landing page is the
    // widest map published rather than whichever title sorts first.
    .orderBy(asc(sql`${regions.parentId} is not null`), asc(regions.title), asc(packs.title))

  // One pass, relying on the ORDER BY above: rows for a region arrive together
  // and in the order they should be offered, so grouping is a lookup rather
  // than a sort of its own.
  const byId = new Map<string, AtlasIndexRegion>()
  const parentOf = new Map<string, string | null>()
  const order: string[] = []

  for (const row of rows) {
    let entry = byId.get(row.regionId)
    if (!entry) {
      entry = {
        slug: row.regionSlug,
        title: row.regionTitle,
        subtitle: row.regionSubtitle,
        packs: [],
        children: [],
      }
      byId.set(row.regionId, entry)
      parentOf.set(row.regionId, row.regionParentId)
      order.push(row.regionId)
    }
    entry.packs.push({
      slug: row.packSlug,
      title: row.packTitle,
      subtitle: row.packSubtitle,
      entityCount: row.packEntities,
    })
  }

  // A plate whose parent is not itself listed is shown as a root. That is not
  // a fallback, it is the honest reading: the reader cannot be sent to the
  // parent, because a region with no published pack has no page to send them
  // to, and hiding the child with it would lose a working atlas over the state
  // of a different one.
  const roots: AtlasIndexRegion[] = []
  for (const id of order) {
    const entry = byId.get(id) as AtlasIndexRegion
    const parent = parentOf.get(id)
    const holder = parent ? byId.get(parent) : undefined
    if (holder) holder.children.push(entry)
    else roots.push(entry)
  }

  return roots
}
