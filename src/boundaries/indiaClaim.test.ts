import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { importBoundaries } from '../../scripts/import-boundaries'
import { db } from '../db/client'
import { applyIndiaClaim, claimSql, CLAIM_PARTS, FIRST_CORRECTED_YEAR } from './indiaClaim'

/** Must fall inside India once the claim is applied. */
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

const owner = async (lng: number, lat: number, year: number) => {
  const rows = await db.execute(sql`
    select name from boundaries
    where valid @> ${year}::int
      and ST_Contains(geom, ST_SetSRID(ST_Point(${lng}, ${lat}), 4326))
    order by ST_Area(geom) asc limit 1
  `)
  return (rows[0] as { name: string } | undefined)?.name ?? null
}

/** Square degrees of a polity's geometry at `year`. Not km²; only ratios are used. */
const area = async (name: string, year: number) => {
  const rows = await db.execute(sql`
    select ST_Area(geom)::float8 as a from boundaries
    where name = ${name} and valid @> ${year}::int
  `) as unknown as Array<{ a: number }>
  return rows.reduce((sum, row) => sum + row.a, 0)
}

const scalar = async (query: ReturnType<typeof sql>) => {
  const rows = await db.execute(query) as unknown as Array<{ v: number }>
  return rows[0].v
}

const YEAR = 2000
const COUNTRIES = ['China', 'Pakistan'] as const

let applied: { added: number; trimmed: number }
let reapplied: { added: number; trimmed: number }
let straddlingBefore: number
const before: Record<string, number> = {}
const after: Record<string, number> = {}

describe('the Jammu and Kashmir correction, in the database', () => {
  beforeAll(async () => {
    // Imported here rather than relied upon: Vitest gives no ordering
    // guarantee between this file and scripts/import-boundaries.test.ts, on a
    // cold database (Task 8) nothing has been imported yet, and — the reason
    // it is unconditional — the importer now applies the correction itself, so
    // whatever is already in the table may be corrected and would measure
    // nothing. `applyClaim: false` is the only place that flag is used.
    // A full import of all 48 snapshots costs about 11 seconds.
    await importBoundaries(undefined, { replace: true, applyClaim: false })

    // Areas must be read before the claim is applied: afterwards the
    // uncorrected geometry is gone. Same for the straddling-row count — see
    // the test that uses it.
    straddlingBefore = await scalar(sql`
      select count(*)::int as v from boundaries
      where lower(valid) < ${FIRST_CORRECTED_YEAR}
        and upper(valid) > ${FIRST_CORRECTED_YEAR}
        and geom && ${claimSql()}
        and ST_Area(ST_Intersection(geom, ${claimSql()})) > 0
    `)
    for (const name of COUNTRIES) before[name] = await area(name, YEAR)
    applied = await applyIndiaClaim()
    for (const name of COUNTRIES) after[name] = await area(name, YEAR)

    reapplied = await applyIndiaClaim()
  }, 900_000)

  // The eleven-point suite from the previous build. Worth stating plainly:
  // against *this* upstream all eleven already resolve to India before the
  // correction runs, because historical-basemaps draws 99.73% of the claim as
  // Indian already — it is not the Natural Earth de facto rendering the old
  // build was correcting. So these are a regression guard, not the proof that
  // the correction did anything; the two coverage tests below are that. They
  // earn their place again in Task 6, where the same points are resolved
  // through the simplified tiles and simplification can move a line.
  it.each(INDIAN)('puts %s inside India', async (_place, lng, lat) => {
    expect(await owner(lng, lat, YEAR)).toBe('India')
  })

  it.each(UNMOVED)('leaves %s in %s', async (_place, lng, lat, expected) => {
    expect(await owner(lng, lat, YEAR)).toBe(expected)
  })

  it('does not touch snapshots before 1945', async () => {
    // 1900 shows the British Raj, not modern states. Applying a modern
    // national convention there would be inventing history.
    expect(await owner(74.8, 34.08, FIRST_CORRECTED_YEAR - 45)).not.toBe('India')
  })

  it('leaves the British Raj overlapping the claim', async () => {
    // The strongest form of "pre-1945 is untouched": the 1938 Raj covers 5.4%
    // of the claim area and must still do so. A correction that reached back
    // in time would have trimmed this to nothing.
    const overlap = await scalar(sql`
      select (ST_Area(ST_Intersection(geom, ${claimSql()}))
              / ST_Area(geom))::float8 as v
      from boundaries where name = 'British Raj' and valid @> 1938
    `)
    expect(overlap).toBeGreaterThan(0.05)
  })

  it('records the correction only on rows valid at or after 1945', async () => {
    const early = await scalar(sql`
      select count(*)::int as v from boundaries
      where upper(valid) <= ${FIRST_CORRECTED_YEAR} and source like '%Survey of India%'
    `)
    expect(early).toBe(0)
  })

  it('gives India the whole claim from 1945 on', async () => {
    // The substantive assertion, and the one that is true whatever upstream
    // happens to draw: no part of the claim may sit outside India in any
    // snapshot from 1945 onward. This is what actually fails before the
    // correction — 0.0768 square degrees of the claim, the worst of the four
    // India rows, lies outside upstream's India. Area, not points, because the
    // gap is a fringe of edge slivers that no fixed list of towns would land
    // in.
    const missing = await scalar(sql`
      select coalesce(max(ST_Area(ST_Difference(${claimSql()}, geom))), 0)::float8 as v
      from boundaries
      where name = 'India' and upper(valid) > ${FIRST_CORRECTED_YEAR}
    `)
    expect(missing).toBeLessThan(1e-9)
  })

  it('leaves no other polity inside the claim from 1945 on', async () => {
    // The other half: added to India and subtracted from everyone else by the
    // same polygon, so the shared edges are identical and no slivers remain.
    // Before the correction, sixteen rows hold 0.224 square degrees of the
    // claim between them — Pakistan, Tibet, Xinjiang, China, Afghanistan,
    // Burma and Bhutan.
    const intruding = await scalar(sql`
      select coalesce(sum(ST_Area(ST_Intersection(geom, ${claimSql()}))), 0)::float8 as v
      from boundaries
      where name <> 'India' and upper(valid) > ${FIRST_CORRECTED_YEAR}
    `)
    expect(intruding).toBeLessThan(1e-9)
  })

  it('costs China no more than 0.42% of its area', async () => {
    // The gotchas quote 0.42% for China and 9.67% for Pakistan. Those were
    // measured against the *previous* build's upstream, which drew the de
    // facto lines, so they are ceilings here rather than expected values: a
    // materially larger loss means the claim polygon is wrong, which is the
    // failure this guards against. The actual losses against
    // historical-basemaps are 0.0042% and 0.041%, three orders of magnitude
    // smaller, because it already draws almost all of the claim as Indian.
    //
    // The lower bound is the part that bites: a claim polygon that failed to
    // load would take nothing from anyone and still sit under the ceiling.
    const lost = (before.China - after.China) / before.China
    expect(lost).toBeGreaterThan(0)
    expect(lost).toBeLessThanOrEqual(0.0042)
  })

  it('costs Pakistan no more than 9.67% of its area', async () => {
    const lost = (before.Pakistan - after.Pakistan) / before.Pakistan
    expect(lost).toBeGreaterThan(0)
    expect(lost).toBeLessThanOrEqual(0.0967)
  })

  it('has no row that both predates 1945 and holds part of the claim', async () => {
    // `applyIndiaClaim` selects on `upper(valid) > 1945`, which is only
    // honest because 1945 is itself a snapshot year, so intervals begin and
    // end on it rather than straddling it. Sixteen rows do span 1945 anyway —
    // a shape unchanged across the 1938 and 1945 snapshots folds into one
    // interval like [1938,1960) — and correcting one of those would apply a
    // post-1945 convention to 1938. None of the sixteen touches the claim
    // (they are Uruguay, Kenya, Switzerland and the like), so the question is
    // moot today. This test is what makes it stay moot: if upstream ever folds
    // an Indian neighbour across 1945, this fails and the fix is to split the
    // interval at 1945, not to loosen the predicate.
    //
    // Counted before the correction ran, in `beforeAll`. Counting it now would
    // be vacuous: the correction trims exactly these rows, so the answer would
    // be zero whether or not any of them ever held part of the claim.
    expect(straddlingBefore).toBe(0)
  })

  it('is safe to run twice', async () => {
    // Task 3's importer clears and reimports, and the correction now runs at
    // the end of it, so a second application is a normal event rather than an
    // accident. It must neither double the source note nor claim work it did
    // not do.
    expect(applied.added).toBeGreaterThan(0)
    expect(applied.trimmed).toBeGreaterThan(0)
    expect(reapplied).toEqual({ added: 0, trimmed: 0 })

    const doubled = await scalar(sql`
      select count(*)::int as v from boundaries
      where (length(source) - length(replace(source, 'Survey of India', ''))) > 15
    `)
    expect(doubled).toBe(0)
  })

  it('names its provenance on every row it changed', async () => {
    const noted = await scalar(sql`
      select count(*)::int as v from boundaries
      where source like '%ne_10m_admin_0_disputed_areas%'
    `)
    expect(noted).toBe(applied.added + applied.trimmed)
    expect(CLAIM_PARTS).toContain('Aksai Chin')
  })
})
