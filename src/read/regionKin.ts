import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import type { RegionKin } from './kin'

/*
 * The shape and the two pure link helpers live in `./kin`, which imports no
 * database client.
 *
 * Not tidiness: `Atlas` is a client island and it needs `kinHref`, because
 * which pack a doorway points at depends on the pack the reader has switched
 * to, which only the browser knows. Importing that from this file pulled
 * `postgres` into the client bundle and failed the build outright. Re-exported
 * so a caller that wants both still has one import.
 */
export type { RegionKin } from './kin'
export { entryPackFor, kinHref } from './kin'

/**
 * The SQL behind both directions.
 *
 * A plate is offered only when it would actually open: published region
 * artifact, at least one published pack laid over it through `era_sets`, and
 * at least one of that pack's entities inside the plate's own bbox. The last
 * condition is the one a regional atlas adds -- a plate shows what is inside
 * it, so a pack whose every figure is somewhere else is a door onto an empty
 * map, and `packsOnRegion` and `publishedAtlases` apply exactly the same test.
 *
 * `entryPack` is the first pack by title, matching the order the switcher and
 * the landing page offer them in, so the link lands on the pack a reader
 * arriving through any other route would also have been given first.
 *
 * Resolved per request rather than baked into the region artifact, for the
 * reason `packsOnRegion` and `layersOnRegion` are: a region artifact is
 * immutable and content-hashed, and this answer changes when a *pack* is
 * published. Baking it in would need every region republished to follow.
 *
 * No slug is named here, and none may be (Rule 3).
 */
async function kin(where: ReturnType<typeof sql>): Promise<RegionKin[]> {
  const rows = await db.execute(sql`
    select r.slug, r.title, r.subtitle,
           ST_XMin(r.bbox) as west, ST_YMin(r.bbox) as south,
           ST_XMax(r.bbox) as east, ST_YMax(r.bbox) as north,
           array(
             select p.slug
             from era_sets es
             join packs p on p.id = es.pack_id
             where es.region_id = r.id
               and p.current_version_id is not null
               and exists (
                 select 1 from entities e
                 where e.pack_id = p.id and e.point && r.bbox
               )
             order by p.title
           ) as packs
    from regions r
    where r.current_artifact_key is not null
      and ${where}
    order by r.title
  `) as unknown as Array<{
    slug: string; title: string; subtitle: string
    west: number; south: number; east: number; north: number
    packs: string[]
  }>

  return rows
    .filter((row) => row.packs.length > 0)
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      bbox: [Number(row.west), Number(row.south), Number(row.east), Number(row.north)],
      entryPack: row.packs[0],
      packs: row.packs,
    }))
}

/**
 * The plates drawn inside this one, which is how a reader goes deeper.
 *
 * The world map offers India because `regions.parent_id` says India sits in
 * it, and for no other reason: there is no list of regions anywhere in `src/`
 * and there may not be. Adding Europe is a file in `data/regions/` naming
 * `world` as its parent, and it appears here on the next import.
 */
export async function childAtlases(regionSlug: string): Promise<RegionKin[]> {
  return kin(sql`r.parent_id = (select id from regions where slug = ${regionSlug})`)
}

/**
 * The plate this one is drawn inside, or null for a root atlas.
 *
 * One step, not an ancestry: the atlas shows the way back out, and a trail of
 * every ancestor is a feature for a depth nobody has built yet.
 */
export async function parentAtlas(regionSlug: string): Promise<RegionKin | null> {
  const [found] = await kin(
    sql`r.id = (select parent_id from regions where slug = ${regionSlug})`,
  )
  return found ?? null
}

