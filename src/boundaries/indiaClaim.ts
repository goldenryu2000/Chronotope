import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../db/client'

/**
 * The first snapshot the correction applies to.
 *
 * 1945 is itself a snapshot year in this corpus, which is why a simple
 * `upper(valid) > 1945` is enough — see `applyIndiaClaim` on the sixteen rows
 * that do span it.
 */
export const FIRST_CORRECTED_YEAR = 1945

/** What upstream calls India. Checked against the table, not assumed. */
export const INDIA = 'India'

/**
 * The Natural Earth `ne_10m_admin_0_disputed_areas` parts unioned into
 * `data/india-claim.geojson` (public domain).
 */
export const CLAIM_PARTS = [
  'Jammu and Kashmir', 'Aksai Chin', 'Gilgit-Baltistan',
  'Azad Kashmir', 'Siachen Glacier', 'Arunachal Pradesh',
] as const

/**
 * Appended to `source` on every row the correction touches, so the divergence
 * travels with the data rather than living in a script that has to be re-run
 * to be believed. It is also the idempotency key: a row already carrying this
 * is not corrected again.
 */
export const SOURCE_NOTE =
  'Jammu and Kashmir redrawn to the boundary the Survey of India requires of maps '
  + 'published in India. Deliberately diverges from upstream (historical-basemaps), '
  + 'which draws the de facto lines. Claim geometry: Natural Earth '
  + `ne_10m_admin_0_disputed_areas (public domain), union of ${CLAIM_PARTS.join(', ')}.`

/** The substring searched for to decide whether a row has already been corrected. */
const MARKER = 'ne_10m_admin_0_disputed_areas'

const CLAIM_PATH = join(process.cwd(), 'data', 'india-claim.geojson')

let cached: string | undefined

/**
 * The claim polygon, as a SQL geometry expression.
 *
 * **Do not simplify it.** It is already simplified once, on its own, so its
 * edges match the detail of the boundaries it is cut into. Simplifying after
 * the cut moved Muzaffarabad — capital of Azad Kashmir, 35 km inside it — back
 * onto the Pakistani side. That is a real bug that shipped once.
 */
export function claimSql(): SQL {
  if (cached === undefined) {
    const parsed = JSON.parse(readFileSync(CLAIM_PATH, 'utf8'))
    // The file is a FeatureCollection of one Feature; accept a bare Feature or
    // a bare geometry too, so a hand-edited file fails loudly rather than
    // silently producing a null geometry.
    const geometry = parsed.type === 'FeatureCollection'
      ? parsed.features[0]?.geometry
      : parsed.type === 'Feature' ? parsed.geometry : parsed
    if (geometry?.type !== 'MultiPolygon' && geometry?.type !== 'Polygon') {
      throw new Error(`${CLAIM_PATH} does not contain a polygon geometry`)
    }
    cached = JSON.stringify(geometry)
  }
  return sql`ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${cached}::text), 4326)))`
}

/** Anything that can run a statement: the pool, or a transaction. */
type Executor = Pick<typeof db, 'execute'>

export interface ClaimResult {
  /** India rows the claim was unioned into. */
  added: number
  /** Rows of every other polity the claim was subtracted from. */
  trimmed: number
}

/**
 * Draws the whole erstwhile princely state as Indian territory from 1945 on.
 *
 * This is what the Survey of India requires of maps published in India, and it
 * **deliberately diverges from upstream**, which draws the de facto lines with
 * Aksai Chin inside China and Gilgit-Baltistan and Azad Kashmir inside
 * Pakistan. If a later change appears to "fix" these rows back to upstream,
 * that is a regression, not a repair.
 *
 * Added to India and subtracted from everyone else **by the same polygon**, so
 * the shared edges are bit-for-bit identical and no slivers open along them.
 *
 * Idempotent by `source`, not by geometry. Comparing geometry to decide
 * whether anything changed does not work here: PostGIS normalises what it
 * touches — rewinding rings, promoting Polygon to MultiPolygon, reordering —
 * so a no-op difference comes back structurally different. An earlier version
 * of this correction, in the previous build, cheerfully reported having
 * trimmed Luxembourg, Cuba and Antarctica.
 *
 * @param conn a transaction, when called from inside the import, so the table
 *   is never briefly visible in its uncorrected state.
 */
export async function applyIndiaClaim(conn: Executor = db): Promise<ClaimResult> {
  const claim = claimSql()

  const added = await conn.execute(sql`
    update boundaries set
      geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geom, ${claim})), 3)),
      source = source || ' | ' || ${SOURCE_NOTE}
    where name = ${INDIA}
      and upper(valid) > ${FIRST_CORRECTED_YEAR}
      and position(${MARKER} in source) = 0
    returning id
  `)

  const trimmed = await conn.execute(sql`
    update boundaries set
      geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference(geom, ${claim})), 3)),
      source = source || ' | ' || ${SOURCE_NOTE}
    where name <> ${INDIA}
      and upper(valid) > ${FIRST_CORRECTED_YEAR}
      and position(${MARKER} in source) = 0
      -- Bounding-box reject first, then a real intersection test. ST_Intersects
      -- alone is not the real test: it is true for polygons that merely touch
      -- along an edge, and every neighbour of the claim does. Positive
      -- intersection area is what "this row actually contains some of the
      -- claim" means, and only sixteen rows in the corpus satisfy it.
      and geom && ${claim}
      and ST_Area(ST_Intersection(geom, ${claim})) > 0
    returning id
  `)

  return { added: added.length, trimmed: trimmed.length }
}
