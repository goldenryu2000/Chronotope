import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import type { Plate } from './kin'

export type { Plate } from './kin'
export {
  childrenOfPlate, entryPackFor, findPlate, flattenPlates, parentOfPlate, plateHref,
} from './kin'

interface PlateRow {
  slug: string
  title: string
  subtitle: string
  parent: string | null
  west: number; south: number; east: number; north: number
  packs: string[]
}

/**
 * Every atlas that would actually open, nested inside the one it is drawn in.
 *
 * One query for the whole tree rather than one per relationship. The atlas
 * route needs three answers from it — the plates this one opens onto, the one
 * it sits in, and the full list for the menu on the title — and asking three
 * times for overlapping subsets of the same eight rows is three round trips to
 * answer one question.
 *
 * A plate is included only when it would open: published region artifact, at
 * least one published pack laid over it through `era_sets`, and at least one
 * of that pack's entities standing inside the plate's own bbox. The last is
 * the condition a regional atlas adds -- a plate shows what is inside it, so a
 * pack whose every figure is somewhere else is a door onto an empty map.
 * `packsOnRegion` and `publishedAtlases` apply exactly the same test.
 *
 * `entryPack` is the first pack by title, matching the order the switcher and
 * the landing page offer them in, so a link lands on the pack a reader
 * arriving by any other route would also have been given first.
 *
 * Resolved per request rather than baked into the region artifact, for the
 * reason `packsOnRegion` and `layersOnRegion` are: a region artifact is
 * immutable and content-hashed, and this answer changes when a *pack* is
 * published. Baking it in would need every region republished to follow.
 *
 * A plate whose parent is not itself published comes back as a root. That is
 * not a fallback but the honest reading: there is no page to send a reader to
 * for a region with no published pack, and hiding a working atlas because of
 * the state of a different one would lose more than it protects.
 *
 * No slug is named here, and none may be (Rule 3).
 */
export async function plateTree(): Promise<Plate[]> {
  const rows = await db.execute(sql`
    select r.slug, r.title, r.subtitle,
           (select p.slug from regions p where p.id = r.parent_id) as parent,
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
    -- Roots before the plates inside them, then by title, matching
    -- publishedAtlases so every list of atlases in the product reads in the
    -- same order. (No backticks in here: this is a template literal.)
    order by (r.parent_id is not null), r.title
  `) as unknown as PlateRow[]

  const byslug = new Map<string, Plate>()
  const order: PlateRow[] = []
  for (const row of rows) {
    if (row.packs.length === 0) continue
    byslug.set(row.slug, {
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      bbox: [Number(row.west), Number(row.south), Number(row.east), Number(row.north)],
      entryPack: row.packs[0],
      packs: row.packs,
      children: [],
    })
    order.push(row)
  }

  const roots: Plate[] = []
  for (const row of order) {
    const plate = byslug.get(row.slug) as Plate
    const parent = row.parent ? byslug.get(row.parent) : undefined
    if (parent) parent.children.push(plate)
    else roots.push(plate)
  }

  return roots
}
