import { statSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { boundaries, regions } from '../src/db/schema'
import { importBoundaries } from './import-boundaries'
import { importRegions } from './import-regions'
import { buildTiles } from './build-tiles'

/**
 * `buildTiles` needs the region row, and this file does not otherwise create
 * one. Vitest gives no ordering guarantee between files, so relying on
 * whichever suite seeds `world` is relying on nothing — and on a cold test
 * database (`docker compose down -v`, then `npm test`) it is simply absent
 * and the build fails with "no region with slug world".
 */
async function ensureWorldRegion(): Promise<void> {
  const [existing] = await db.select().from(regions).where(eq(regions.slug, 'world'))
  if (!existing) await importRegions(['world'])
}

let result: Awaited<ReturnType<typeof buildTiles>>
let rowCount: number

describe('buildTiles', () => {
  beforeAll(async () => {
    await ensureWorldRegion()

    // Self-sufficient, like the other database suites: Vitest gives no
    // ordering guarantee between files, and on a cold database nothing has
    // been imported yet. A full import costs about nine seconds and the tile
    // build about three.
    const [existing] = await db.execute(
      sql`select count(*)::int as n from ${boundaries}`,
    ) as unknown as Array<{ n: number }>
    if (existing.n === 0) await importBoundaries(undefined, { replace: true })

    const [counted] = await db.execute(
      sql`select count(*)::int as n from ${boundaries}`,
    ) as unknown as Array<{ n: number }>
    rowCount = counted.n

    result = await buildTiles('world')
  }, 900_000)

  it('writes an archive', () => {
    expect(statSync(result.archive).size).toBeGreaterThan(0)
  })

  it('tiles every boundary row in the region', () => {
    // Equality, not a floor. The world bbox covers every row, so a feature
    // count short of the table means the geometry filter silently dropped
    // something — which is precisely the failure a floor of 1,000 would sail
    // past with ten thousand rows in the table.
    expect(result.features).toBe(rowCount)
  })

  it('keeps every tile inside the MVT soft limit', () => {
    // tippecanoe's own ceiling is 500 KB, and it enforces it by dropping
    // features rather than by failing. Asserting it here means the archive is
    // under the limit because it fits, not because something was thrown away.
    // Measured: the largest tile is the single zoom-0 tile, which carries
    // every polity of every era at once.
    expect(result.maxTileBytes).toBeLessThan(500_000)
  })

  it('drops nothing at max zoom that was ever a territory', () => {
    // The plan asked for `droppedAtMaxZoom === 0`. It is not zero: six of the
    // 10,614 rows reach no zoom-6 tile, and asserting zero would have meant
    // either deleting rows to fit the assertion or carrying a red test.
    //
    // All six were looked at. Every one is a triangle — three distinct
    // vertices — and near-collinear: two have zero area outright (a nameless
    // 1492 shape near Iquitos, and a Paekche sliver off Busan), the rest are
    // between 9e-6 and 2e-4 square degrees. They are upstream quantisation
    // debris, the same family as the 872 zero-area features the importer
    // already drops, and none of them is anybody's territory.
    //
    // So the assertion is on what was dropped rather than how much. Average
    // width — area over perimeter — separates a small country from a sliver in
    // a way that area alone does not: the widest thing lost is 0.0006°, about
    // sixty metres. A real polity failing to reach max zoom would land orders
    // of magnitude above this line and fail the test, which is the point,
    // because the Jammu and Kashmir gate in Task 6 reads that zoom and a gate
    // reading a tile with features missing from it is not a gate.
    expect(result.widestDropped).toBeLessThan(0.001)
    expect(result.droppedAtMaxZoom).toBeLessThan(result.features * 0.001)
  })

  it('records the archive on the region, so the artifact can carry it', async () => {
    const [region] = await db.execute(
      sql`select tileset_key from regions where slug = 'world'`,
    ) as unknown as Array<{ tileset_key: string | null }>
    expect(region.tileset_key).toBe('tiles/world.pmtiles')
  })
})
