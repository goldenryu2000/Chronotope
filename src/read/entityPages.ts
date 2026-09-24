import { sql } from 'drizzle-orm'
import { db } from '../db/client'

export interface EntityPage {
  region: string
  pack: string
  entity: string
}

/**
 * Every (region, pack, entity) triple that has a page.
 *
 * Not a cross product. A region draws the figures inside its own edges, so a
 * second plate multiplying every entity by every region would list hundreds of
 * pages the atlas never links and whose back link leads to a map without them.
 * The bbox test is the same one the atlas and the entity route's `loadEntity`
 * apply, and on `world` it selects everything.
 *
 * The entity route prerenders from this and the sitemap lists it, so the two
 * cannot disagree about which pages exist.
 */
export async function entityPages(): Promise<EntityPage[]> {
  const rows = await db.execute(sql`
    select r.slug as region, p.slug as pack, e.slug as entity
    from entities e
    join packs p on p.id = e.pack_id
    join regions r on e.point && r.bbox
  `) as unknown as EntityPage[]

  return rows.map((row) => ({ region: row.region, pack: row.pack, entity: row.entity }))
}
