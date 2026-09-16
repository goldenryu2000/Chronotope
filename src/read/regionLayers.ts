import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import type { LayerKind } from '../data/schemas'

/** One entry in the layer menu, resolved on the server. */
export interface RegionLayer {
  slug: string
  name: string
  kind: LayerKind
  paletteSlot: number
  /** Inclusive at both ends, as every artifact range is. */
  valid: { start: number; end: number }
  note: string
  /** The immutable artifact, fetched when the reader switches the layer on. */
  artifactUrl: string
}

/**
 * Every published layer whose geometry reaches into a region.
 *
 * Computed rather than stored. `layers` has no region column and no placement
 * table, for the reason `boundaries` has neither: the Silk Road is not owned
 * by a region, and a region is a view onto global geometry produced by
 * clipping to its bbox. A placement table would be a second answer to a
 * question the schema already answers one way, and the two would drift.
 *
 * Resolved per request rather than baked into the region artifact. That was
 * the first draft of the design and it is wrong: a region artifact is
 * immutable and content-hashed, so layer urls inside it go stale the moment a
 * layer is republished, and every region would need republishing to follow.
 * `packsOnRegion` resolves the pack switcher the same way and for the same
 * reason.
 *
 * `current_artifact_key is not null` is what keeps the offer honest: a layer
 * imported but never published would be a menu entry whose fetch 404s.
 *
 * The subquery also requires the region itself to carry a
 * `current_artifact_key`, mirroring the same guard in `packsOnRegion` and for
 * the same reason: it is exactly the condition the atlas route needs to avoid
 * a 404. Belt-and-braces here rather than load-bearing, since the route
 * resolves the region artifact and 404s before this function's result is ever
 * used — but the two functions answer the same shape of question, and they
 * should not drift over a difference nobody chose on purpose.
 *
 * No slug is named here, and none may be (Rule 3).
 */
export async function layersOnRegion(regionSlug: string): Promise<RegionLayer[]> {
  const base = process.env.NEXT_PUBLIC_ARTIFACT_BASE_URL
  if (!base) throw new Error('NEXT_PUBLIC_ARTIFACT_BASE_URL is not set')

  // Raw SQL for the "&&" bbox operator, which is what the gist index on
  // layer_features.geom answers, and for lower/upper on the range. Drizzle's
  // query builder has no way to express either.
  const rows = await db.execute(sql`
    select l.slug, l.name, l.kind, l.palette_slot,
           lower(l.valid) as start, upper(l.valid) - 1 as end,
           l.note, l.current_artifact_key
    from layers l
    where l.current_artifact_key is not null
      and l.status = 'published'
      and exists (
        select 1
        from layer_features f, regions r
        where f.layer_id = l.id
          and r.slug = ${regionSlug}
          and r.current_artifact_key is not null
          and f.geom && r.bbox
      )
    -- Slot, then slug: two layers can share a slot, and the menu and the
    -- timeline lanes should not swap places between one request and the next.
    order by l.palette_slot, l.slug
  `) as unknown as Array<{
    slug: string; name: string; kind: LayerKind; palette_slot: number
    start: number; end: number; note: string; current_artifact_key: string
  }>

  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    paletteSlot: row.palette_slot,
    valid: { start: row.start, end: row.end },
    note: row.note,
    artifactUrl: `${base}/${row.current_artifact_key}`,
  }))
}
