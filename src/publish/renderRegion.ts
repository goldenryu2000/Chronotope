import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { boundaries, eraSets, eras, regions } from '../db/schema'
import { type Region, RegionSchema } from '../data/schemas'

export async function renderRegion(regionId: string): Promise<Region> {
  const [region] = await db
    .select({
      slug: regions.slug,
      title: regions.title,
      subtitle: regions.subtitle,
      west: sql<number>`ST_XMin(${regions.bbox})`,
      south: sql<number>`ST_YMin(${regions.bbox})`,
      east: sql<number>`ST_XMax(${regions.bbox})`,
      north: sql<number>`ST_YMax(${regions.bbox})`,
      minZoom: regions.minZoom,
      maxZoom: regions.maxZoom,
      defaultCamera: regions.defaultCamera,
      range: regions.range,
      theme: regions.theme,
      tilesetKey: regions.tilesetKey,
    })
    .from(regions)
    .where(eq(regions.id, regionId))
  if (!region) throw new Error(`no such region: ${regionId}`)

  // The region's default periodization: the era set for this region whose
  // packId is null. Every published region must have exactly one — a region
  // with no default era set has no timeline to render. Failing here, in the
  // publish pipeline, gives a message that names the region; letting it
  // through as `eras: []` would still satisfy RegionSchema (it has no
  // `.min(1)`) and defer the failure to buildScale, in a visitor's browser,
  // with no way back to which region was at fault.
  const [defaultSet] = await db
    .select({ id: eraSets.id })
    .from(eraSets)
    .where(and(eq(eraSets.regionId, regionId), isNull(eraSets.packId)))
  if (!defaultSet) {
    throw new Error(`region "${region.slug}" has no default era set (era_sets row with packId null)`)
  }

  // What the archive can actually draw, which is not what the timeline offers:
  // the corpus stops at 2010 and the world region's range runs to 2026. Bounded
  // by the region's own bbox, the same clip `scripts/build-tiles.ts` cuts the
  // archive with, so a region is never told it has borders that were tiled out
  // of it. `upper(valid)` is exclusive, so the last year drawn is one less.
  const [coverage] = await db
    .select({
      first: sql<number | null>`min(lower(${boundaries.valid}))`,
      last: sql<number | null>`max(upper(${boundaries.valid})) - 1`,
    })
    .from(boundaries)
    .where(sql`${boundaries.geom} && (select bbox from regions where id = ${regionId}::uuid)`)

  // Every year an interval starts is a year the map redraws, except the first,
  // which is where the map begins. Distinct, because a snapshot changes many
  // polities at once and the reader cares about the redraw, not the count.
  const changeRows = await db
    .selectDistinct({ year: sql<number>`lower(${boundaries.valid})` })
    .from(boundaries)
    .where(sql`${boundaries.geom} && (select bbox from regions where id = ${regionId}::uuid)`)
    .orderBy(sql`lower(${boundaries.valid})`)
  const borderChanges = changeRows.slice(1).map((row) => row.year)

  const eraRows = await db
    .select()
    .from(eras)
    .where(eq(eras.eraSetId, defaultSet.id))
    .orderBy(asc(eras.ordinal))

  const artifact = {
    id: region.slug,
    title: region.title,
    subtitle: region.subtitle,
    bbox: [region.west, region.south, region.east, region.north] as [number, number, number, number],
    minZoom: region.minZoom,
    maxZoom: region.maxZoom,
    defaultCamera: region.defaultCamera,
    range: { start: region.range[0], end: region.range[1] - 1 },
    theme: region.theme,
    ...(region.tilesetKey ? { tilesetKey: region.tilesetKey } : {}),
    ...(coverage?.first !== null && coverage?.last !== null
      ? { borderYears: { first: coverage.first, last: coverage.last } }
      : {}),
    ...(borderChanges.length > 0 ? { borderChanges } : {}),
    eras: eraRows.map((e) => ({
      id: e.slug, label: e.label, start: e.start, end: e.end,
      weight: e.weight, blurb: e.blurb,
    })),
  }

  return RegionSchema.parse(artifact)
}
