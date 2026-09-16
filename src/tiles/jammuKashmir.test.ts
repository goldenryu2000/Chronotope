import { existsSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTiles } from '../../scripts/build-tiles'
import { importBoundaries } from '../../scripts/import-boundaries'
import { importWorldRegion } from '../../scripts/import-legacy'
import { claimSql } from '../boundaries/indiaClaim'
import { db } from '../db/client'
import { boundaries, regions } from '../db/schema'
import { featuresAt, featuresIn, TileArchive, type BBox } from './archive'

/**
 * The gate.
 *
 * `src/boundaries/indiaClaim.test.ts` proves the Jammu and Kashmir correction
 * against the `boundaries` table. This file proves it against the tiles, and
 * the two are different artifacts: **tippecanoe simplifies between them**, so a
 * line the database draws correctly can still reach the screen on the wrong
 * side of a town. That is not hypothetical — simplifying the claim polygon
 * after the cut moved Muzaffarabad back into Pakistan once already.
 *
 * A failure here while the SQL suite passes means simplification moved the
 * line, and the fix is to revisit how the claim geometry is simplified — never
 * to loosen what is asserted here.
 *
 * The suite builds its own archive rather than reading whatever is on disk. A
 * gate that can pass against a stale artifact is not gating anything. Postgres
 * appears below only to hold the claim polygon and do the set algebra; every
 * scrap of India's geometry here was read back out of the tiles.
 */

/** Must fall inside India. The same eleven points as the SQL suite. */
const INDIAN = [
  ['Aksai Chin', 79.0, 35.1], ['Leh', 77.58, 34.16], ['Gilgit', 74.31, 35.92],
  ['Skardu', 75.63, 35.30], ['Muzaffarabad', 73.47, 34.36], ['Mirpur', 73.75, 33.15],
  ['Srinagar', 74.80, 34.08], ['Siachen', 77.10, 35.42], ['Tawang', 91.87, 27.59],
  ['Itanagar', 93.61, 27.08], ['Kalapani', 80.75, 30.20],
] as const

/** Must be unaffected. A correction that moves these is wrong. */
const UNMOVED = [
  ['Lahore', 74.34, 31.55, 'Pakistan'], ['Islamabad', 73.05, 33.68, 'Pakistan'],
  ['Peshawar', 71.58, 34.01, 'Pakistan'], ['Kathmandu', 85.32, 27.71, 'Nepal'],
  ['Thimphu', 89.64, 27.47, 'Bhutan'], ['Beijing', 116.41, 39.90, 'China'],
] as const

const YEAR = 2000

/** What the difference between the claim and the tiles' India looks like. */
interface Uncovered {
  /** Square degrees of claim no India polygon in the tiles covers. */
  area: number
  /** Radius of the largest circle fitting inside it, in degrees. */
  radius: number
  /** Where that circle sits, for a failure message worth reading. */
  worst: string
}

/**
 * `buildTiles` needs the region row, and this file does not otherwise create
 * one. Vitest gives no ordering guarantee between files, so relying on
 * whichever suite seeds `world` is relying on nothing — and on a cold test
 * database (`docker compose down -v`, then `npm test`) it is simply absent
 * and the build fails with "no region with slug world".
 */
async function ensureWorldRegion(): Promise<void> {
  const [existing] = await db.select().from(regions).where(eq(regions.slug, 'world'))
  if (!existing) await importWorldRegion()
}

let archive: TileArchive
let zoom: number
let indiaParts: number
let uncovered: Uncovered

/** The polities the tiles put over a point in `YEAR`, by name. */
const namesAt = (lng: number, lat: number): string[] =>
  featuresAt(archive, lng, lat, zoom)
    .filter((f) => f.validFrom <= YEAR && YEAR < f.validTo)
    .map((f) => f.name)

describe('the Jammu and Kashmir correction, in the tiles', () => {
  beforeAll(async () => {
    await ensureWorldRegion()

    const [existing] = await db.execute(
      sql`select count(*)::int as n from ${boundaries}`,
    ) as unknown as Array<{ n: number }>
    if (existing.n === 0) await importBoundaries(undefined, { replace: true })

    const built = await buildTiles('world')
    expect(existsSync(built.archive)).toBe(true)
    archive = TileArchive.open(built.archive)
    // The deepest zoom in the archive: the least simplified geometry a client
    // can ask for. If the correction survives anywhere it survives here, so a
    // failure at this zoom is unambiguous.
    zoom = archive.header.maxZoom

    const [box] = await db.execute(sql`
      select ST_XMin(g) as west, ST_YMin(g) as south,
             ST_XMax(g) as east, ST_YMax(g) as north
      from (select ${claimSql()} as g) s
    `) as unknown as Array<BBox>

    // Every India polygon the tiles covering the claim carry, still clipped to
    // its tile — reassembled by ST_Union, which closes the tile seams because
    // tippecanoe writes each feature with a buffer past its tile edge.
    const parts = featuresIn(archive, zoom, box)
      .filter((f) => f.name === 'India' && f.validFrom <= YEAR && YEAR < f.validTo)
      .map((f) => JSON.stringify(f.geometry))
    indiaParts = parts.length

    const union = sql.join(
      parts.map((g) => sql`ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${g}::text), 4326))`),
      sql`,`,
    )
    const [row] = await db.execute(sql`
      select ST_Area(d)::float8 as area,
             (ST_MaximumInscribedCircle(d)).radius::float8 as radius,
             ST_AsText(ST_Centroid((ST_MaximumInscribedCircle(d)).center)) as worst
      from (
        select ST_Difference(${claimSql()}, u) as d
        from (select ST_UnaryUnion(ST_Collect(array[${union}])) as u) t
      ) s
    `) as unknown as Array<Uncovered>
    uncovered = row
  }, 900_000)

  afterAll(() => archive?.close())

  it('carries India across the claim at all', () => {
    // A guard on the measurement rather than on the data. If the layer were
    // renamed, or the year filter stopped matching, `parts` would be empty and
    // every coverage assertion below would compare the claim against nothing —
    // which fails loudly here instead of misreporting there.
    expect(indiaParts).toBeGreaterThan(0)
  })

  it('leaves no part of the claim outside India', () => {
    // The substantive gate, and the reason it is measured by area rather than
    // by the towns below: what upstream withholds from India is a fringe along
    // the claim's edge that no fixed list of towns lands in.
    //
    // Measured, on this corpus at zoom 6:
    //   correction applied     0.0022 sq deg uncovered
    //   correction disabled    0.0753 sq deg uncovered
    // The line sits between them with room on both sides. The residual 0.0022
    // is not a defect in the correction — the database suite asserts the same
    // difference is under 1e-9 — it is precisely the simplification this file
    // exists to bound, spread as a 4.7e-5 deg fringe along 46 deg of edge.
    expect(uncovered.area).toBeLessThan(0.01)
  })

  it('leaves out edge sliver, not territory', () => {
    // The sharper half, and the one that would catch a correction that covered
    // the claim's area while losing a district in the middle of it. This is
    // the largest circle that fits inside the uncovered part: how *thick* the
    // worst gap is, not how much of it there is, the same distinction
    // `widestDropped` draws in the tile build.
    //
    // Measured: 5.6e-5 deg (about six metres) with the correction applied,
    // against 1.7e-2 deg (about 1.8 km, in Gilgit-Baltistan) without it. Two
    // and a half orders of magnitude apart; the threshold is 110 metres.
    expect(uncovered.radius, `worst gap at ${uncovered.worst}`).toBeLessThan(0.001)
  })

  // The seventeen points from the SQL suite, resolved through the tiles.
  //
  // Worth stating as plainly here as it is stated there: against *this*
  // upstream they do not discriminate. historical-basemaps already draws
  // 99.73% of the claim as Indian, so all seventeen pass with the correction
  // disabled — verified by building an archive from an uncorrected import.
  // They are a regression guard against a gross break, and the two coverage
  // tests above are the proof that the correction reached the tiles.
  it.each(INDIAN)('puts $0 inside India', (_place, lng, lat) => {
    expect(namesAt(lng, lat)).toContain('India')
  })

  it.each(UNMOVED)('leaves $0 in $3', (_place, lng, lat, expected) => {
    const names = namesAt(lng, lat)
    expect(names).toContain(expected)
    // The half of this the SQL suite cannot state as plainly. There, "owner"
    // is the smallest polygon containing the point, so India spilling over
    // Lahore would still resolve to Pakistan and pass. A tile clips its
    // features, so smallest-wins is meaningless here — which forces the
    // stronger assertion: India is not over this town at all.
    expect(names).not.toContain('India')
  })
})
