import { and, asc, count, eq, isNotNull, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  entities, layers, packs, regions, tourStopLayers, tourStops, tourVersions, tours,
} from '../db/schema'

function base(): string {
  const value = process.env.NEXT_PUBLIC_ARTIFACT_BASE_URL
  if (!value) throw new Error('NEXT_PUBLIC_ARTIFACT_BASE_URL is not set')
  return value
}

export interface TourSummary {
  slug: string
  title: string
  subtitle: string
  description: string
  estimatedMinutes: number
  stops: number
  artifactUrl: string
}

/**
 * Every published tour on a region, for the index page.
 *
 * Joined through `current_version_id`, which is the only column that says a
 * tour has ever been published — the same condition the stop route needs to
 * avoid a 404, so a tour seeded but never published is left out rather than
 * offered as a dead end. `packsOnRegion` is built the same way and for the
 * same reason.
 */
export async function toursOnRegion(regionSlug: string): Promise<TourSummary[]> {
  const rows = await db
    .select({
      slug: tours.slug,
      title: tours.title,
      subtitle: tours.subtitle,
      description: tours.description,
      estimatedMinutes: tours.estimatedMinutes,
      key: tourVersions.artifactKey,
      stops: count(tourStops.id),
    })
    .from(tours)
    .innerJoin(regions, eq(tours.regionId, regions.id))
    .innerJoin(tourVersions, eq(tours.currentVersionId, tourVersions.id))
    .innerJoin(tourStops, eq(tourStops.tourId, tours.id))
    .where(eq(regions.slug, regionSlug))
    .groupBy(tours.id, tourVersions.artifactKey)
    .orderBy(asc(tours.title))

  return rows.map(({ key, ...tour }) => ({ ...tour, artifactUrl: `${base()}/${key}` }))
}

export async function currentTourUrl(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ key: tourVersions.artifactKey })
    .from(tours)
    .innerJoin(tourVersions, eq(tours.currentVersionId, tourVersions.id))
    .where(and(eq(tours.slug, slug), isNotNull(tours.currentVersionId)))
    .limit(1)
  return row ? `${base()}/${row.key}` : null
}

/**
 * What the atlas needs to open on a stop, without fetching the tour first.
 *
 * The same trade-off `loadTitles` documents in the atlas route: this request
 * already talks to Postgres to resolve the version pointer, so reading four
 * more columns adds no dependency, where fetching the artifact server-side
 * would mean an HTTP round trip back to ourselves and a Zod parse of a whole
 * tour to recover a pack slug and a year.
 *
 * It buys the absence of a jump. Without it the atlas opens on the pack's own
 * `startYear` and corrects itself once the tour artifact lands, in front of the
 * reader.
 */
export async function tourOpening(slug: string, ordinal: number) {
  const [row] = await db
    .select({
      id: tourStops.id,
      pack: packs.slug,
      year: tourStops.year,
      camera: tourStops.camera,
      entityId: entities.slug,
    })
    .from(tourStops)
    .innerJoin(tours, eq(tourStops.tourId, tours.id))
    .innerJoin(packs, eq(tourStops.packId, packs.id))
    .leftJoin(entities, eq(tourStops.entityId, entities.id))
    .where(and(eq(tours.slug, slug), eq(tourStops.ordinal, ordinal)))
    .limit(1)
  if (!row) return null

  // Ordered for the reason `renderTour` gives, and by the same two keys: the
  // artifact and this read must agree, or one stop lights the same layers in a
  // different order depending on which of the two the atlas heard first. The
  // slug breaks a tie on slot, which the schema permits.
  const stopLayers = await db
    .select({ slug: layers.slug })
    .from(tourStopLayers)
    .innerJoin(layers, eq(tourStopLayers.layerId, layers.id))
    .where(eq(tourStopLayers.stopId, row.id))
    .orderBy(asc(layers.paletteSlot), asc(layers.slug))

  const [total] = await db
    .select({ stops: count(tourStops.id) })
    .from(tourStops)
    .innerJoin(tours, eq(tourStops.tourId, tours.id))
    .where(eq(tours.slug, slug))

  // Spelled out rather than spread, so the stop's row id stays in this
  // function: what the route wants is a view, and a uuid is not part of one.
  return {
    pack: row.pack,
    year: row.year,
    camera: row.camera,
    entityId: row.entityId,
    layers: stopLayers.map((layer) => layer.slug),
    stops: total.stops,
  }
}

/** One tour as the landing page offers it. */
export interface TourIndexTour {
  slug: string
  title: string
  subtitle: string
  stops: number
  estimatedMinutes: number
}

/** A region, with the tours that walk it. */
export interface TourIndexRegion {
  slug: string
  title: string
  /** Never empty: a region with no published tour is not listed at all. */
  tours: TourIndexTour[]
}

/**
 * Every published tour, grouped by the map it walks.
 *
 * `toursOnRegion` above answers the same question for one region, which is
 * what the tour index page needs. The landing page is offering a choice
 * across everything published, so it groups the way `publishedAtlases` does,
 * and for the same reason: what the reader is picking is a route through a
 * particular map, and the grouping says so before they arrive.
 *
 * The `current_version_id` join is what keeps the offer honest. A tour seeded
 * but never published has no artifact behind it and its route 404s, so it is
 * left out rather than listed as a dead end. `publishedAtlases` filters packs
 * on exactly the same condition.
 *
 * No slug is named here, and none may be (Rule 3).
 */
export async function publishedTours(): Promise<TourIndexRegion[]> {
  const rows = await db
    .select({
      regionSlug: regions.slug,
      regionTitle: regions.title,
      slug: tours.slug,
      title: tours.title,
      subtitle: tours.subtitle,
      estimatedMinutes: tours.estimatedMinutes,
      stops: count(tourStops.id),
    })
    .from(tours)
    .innerJoin(regions, eq(tours.regionId, regions.id))
    .innerJoin(tourVersions, eq(tours.currentVersionId, tourVersions.id))
    .innerJoin(tourStops, eq(tourStops.tourId, tours.id))
    .groupBy(tours.id, regions.slug, regions.title, regions.parentId)
    // Roots before the plates drawn inside them, matching `publishedAtlases`.
    // The landing page offers both lists in the same order, so a reader who
    // read "World, then India" under the atlases should not find "India, then
    // World" under the tours.
    .orderBy(asc(sql`${regions.parentId} is not null`), asc(regions.title), asc(tours.title))

  // One pass, relying on the ORDER BY: rows for a region arrive together and
  // in the order they should be offered, so grouping is a lookup rather than a
  // sort of its own.
  const byRegion = new Map<string, TourIndexRegion>()
  for (const row of rows) {
    let entry = byRegion.get(row.regionSlug)
    if (!entry) {
      entry = { slug: row.regionSlug, title: row.regionTitle, tours: [] }
      byRegion.set(row.regionSlug, entry)
    }
    entry.tours.push({
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      stops: row.stops,
      estimatedMinutes: row.estimatedMinutes,
    })
  }

  return [...byRegion.values()]
}
