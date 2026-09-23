import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { boundaries, regions } from '../db/schema'
import { importBoundaries } from '../../scripts/import-boundaries'
import { importRegions } from '../../scripts/import-regions'
import { borderSpan, heroFrames } from './heroFrames'

beforeAll(async () => {
  const [existing] = await db.select().from(regions).where(eq(regions.slug, 'world'))
  if (!existing) await importRegions(['world'])

  const [counted] = await db.execute(
    sql`select count(*)::int as n from ${boundaries}`,
  ) as unknown as Array<{ n: number }>
  if (counted.n === 0) await importBoundaries(undefined, { replace: true })
}, 900_000)

describe('heroFrames', () => {
  it('draws three moments, in order', async () => {
    const frames = await heroFrames('world')
    expect(frames).toHaveLength(3)
    expect(frames.map((f) => f.year)).toEqual([...frames.map((f) => f.year)].sort((a, b) => a - b))
  })

  it('picks years the region actually has boundaries for', async () => {
    // Spread across what the corpus covers rather than hardcoded: a region
    // whose data begins in 1800 must not open on an empty plate, and no year
    // may be named in engine code (Rule 3).
    const [coverage] = await db.execute(sql`
      select min(lower(valid))::int as first, (max(upper(valid)) - 1)::int as last
      from boundaries
    `) as unknown as Array<{ first: number; last: number }>

    for (const { year } of await heroFrames('world')) {
      expect(year).toBeGreaterThanOrEqual(coverage.first)
      expect(year).toBeLessThanOrEqual(coverage.last)
    }
  })

  it('returns drawable svg for each', async () => {
    for (const { path } of await heroFrames('world')) {
      expect(path.startsWith('M')).toBe(true)
      // Enough of a world to be worth showing. A near-empty plate would read
      // as a broken hero rather than as an early year.
      expect(path.length).toBeGreaterThan(2_000)
    }
  })

  it('is empty for a region with no boundaries, rather than three blank plates', async () => {
    expect(await heroFrames('no-such-region')).toEqual([])
  })
})

describe('borderSpan', () => {
  it('reports the years a region has borders for', async () => {
    const span = await borderSpan('world')
    expect(span).not.toBeNull()
    expect(span!.first).toBeLessThan(span!.last)
  })

  it('is null for a region with no boundaries', async () => {
    expect(await borderSpan('no-such-region')).toBeNull()
  })
})
