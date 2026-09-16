import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { boundaries } from '../src/db/schema'
import { importBoundaries } from './import-boundaries'

let result: Awaited<ReturnType<typeof importBoundaries>>

describe('importBoundaries', () => {
  beforeAll(async () => {
    await db.delete(boundaries)
    result = await importBoundaries()
  }, 600_000)

  it('reads every snapshot', () => {
    expect(result.snapshots).toBe(48)
  })

  it('deduplicates: substantially fewer rows than raw observations', () => {
    // 16,677 geometries were counted across the 48 files, but 1,158 of them
    // observe nothing: 286 have null geometry, and 872 have no area once
    // ST_MakeValid is done with them — mapshaper's `remove-empty` runs before
    // quantization upstream, so anything quantization then collapses survives
    // into the published files as a degenerate polygon. Hence a floor, not an
    // equality: 15,519 at the time of writing.
    expect(result.observations).toBeGreaterThan(15_000)

    // Not merely `<`. Dedup here fails *silently* — TopoJSON quantises per
    // file, so an identity test that is even slightly too strict returns one
    // row per snapshot with no error and no warning, and the ratio is the only
    // thing that says so. The measured ratio is 1.46x (10,614 rows); this
    // asks for 1.25x, which the md5-of-precision-reduced-geometry approach
    // this task started from could not reach at any defensible tolerance.
    expect(result.rows).toBeLessThan(result.observations * 0.8)

    // And a floor, because the two failure directions do not cost the same:
    // merging shapes that differ puts wrong borders on screen, splitting
    // shapes that match only makes the table bigger. A ceiling alone rewards
    // an ever looser tolerance. This is the coarse backstop against wholesale
    // over-merging — 0.548 with the area guard at 0.5, ten times its measured
    // value — and it is deliberately not the only guard: it does not catch a
    // ten-times-loose Hausdorff tolerance (0.622), which is what the two tests
    // below are for.
    expect(result.rows).toBeGreaterThan(result.observations * 0.5)
  })

  it('refuses to merge two polities whose shapes are known to differ', async () => {
    // The aggregate ratio says dedup happened, not that it was right. These
    // pin the other side, on shapes whose changes were checked by hand.
    //
    // `Plateau fichers and hunter gatherers` holds one shape across the
    // seventeen snapshots from -1500 to 700 (13 vertices, area within 0.3%,
    // no point moved more than 0.016°) and then really does change at 800:
    // area 88.74 -> 82.50, Hausdorff 3.43°, the north-western lobe cut off.
    // No single row may span that.
    const plateau = await db.execute(sql`
      select (count(*) filter (where valid @> 700))::int as before,
             (count(*) filter (where valid @> 800))::int as after,
             (count(*) filter (where valid @> 700 and valid @> 800))::int as spanning
      from ${boundaries} where name = 'Plateau fichers and hunter gatherers'
    `)
    expect(plateau[0].spanning).toBe(0)
    expect(plateau[0].before).toBe(1)
    expect(plateau[0].after).toBe(1)

    // France appears in 27 snapshots and its outline moves at nearly every
    // one: 25 rows, measured. At a ten-times-loose Hausdorff tolerance it
    // collapses to 21, so this catches that break with four rows to spare.
    const france = await db.execute(
      sql`select count(*)::int as n from ${boundaries} where name = 'France'`,
    )
    expect(france[0].n).toBeGreaterThanOrEqual(24)
  })

  it('keeps the granularity of the atlas as a whole', async () => {
    // The single-polity pins above can pass by luck; this is the same claim
    // made across the whole table. 292 named polities resolve to five or more
    // distinct shapes at the measured tolerances. Both ways of loosening the
    // identity test flatten that: 214 at ten times the Hausdorff tolerance,
    // 254 at ten times the area guard. 260 sits below the true value with
    // room to spare and above both failures.
    const rows = await db.execute(sql`
      select count(*)::int as n from (
        select name from ${boundaries} where name <> '' group by name having count(*) >= 5
      ) many_shaped
    `)
    expect(rows[0].n).toBeGreaterThanOrEqual(260)
  })

  it('stores validity as a non-empty end-exclusive range', async () => {
    const rows = await db.execute(
      sql`select count(*)::int as n from ${boundaries} where isempty(valid)`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('keeps every geometry valid', async () => {
    const rows = await db.execute(
      sql`select count(*)::int as n from ${boundaries} where not ST_IsValid(geom)`,
    )
    expect(rows[0].n).toBe(0)
  })

  it('answers a temporal containment query', async () => {
    const rows = await db.execute(
      sql`select count(*)::int as n from ${boundaries} where valid @> 1600`,
    )
    // The 1600 snapshot has features; the exact count depends on dedup, but a
    // year with a snapshot must never come back empty.
    expect(rows[0].n).toBeGreaterThan(50)
  })

  it('preserves upstream attributes nothing else carries', async () => {
    const rows = await db.execute(
      sql`select properties from ${boundaries} where properties ? 'BORDERPRECISION' limit 1`,
    )
    expect(rows.length).toBe(1)
  })
})
