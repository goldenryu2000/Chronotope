import { asc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { entities, layers, packs, regions, tourStopLayers, tourStops, tours } from '../db/schema'
import { type Tour, TourSchema } from '../data/schemas'

/**
 * Tour rows to the artifact the browser reads.
 *
 * Foreign keys become slugs on the way out, the way `renderPack` turns an
 * entity's row id into its slug: a uuid is how the database says who someone
 * is, and a slug is how a URL and a reader do.
 */
export async function renderTour(tourId: string): Promise<Tour> {
  const [tour] = await db
    .select({
      slug: tours.slug,
      regionSlug: regions.slug,
      title: tours.title,
      subtitle: tours.subtitle,
      description: tours.description,
      estimatedMinutes: tours.estimatedMinutes,
    })
    .from(tours)
    .innerJoin(regions, eq(tours.regionId, regions.id))
    .where(eq(tours.id, tourId))
  if (!tour) throw new Error(`no such tour: ${tourId}`)

  const stopRows = await db
    .select({
      id: tourStops.id,
      ordinal: tourStops.ordinal,
      pack: packs.slug,
      entity: entities.slug,
      year: tourStops.year,
      camera: tourStops.camera,
      title: tourStops.title,
      locationLabel: tourStops.locationLabel,
      narration: tourStops.narration,
    })
    .from(tourStops)
    .innerJoin(packs, eq(tourStops.packId, packs.id))
    .leftJoin(entities, eq(tourStops.entityId, entities.id))
    .where(eq(tourStops.tourId, tourId))
    .orderBy(asc(tourStops.ordinal))

  if (stopRows.length === 0) throw new Error(`tour "${tour.slug}" has no stops`)

  const stopLayerRows = await db
    .select({ stopId: tourStopLayers.stopId, slug: layers.slug })
    .from(tourStopLayers)
    .innerJoin(layers, eq(tourStopLayers.layerId, layers.id))
    .innerJoin(tourStops, eq(tourStopLayers.stopId, tourStops.id))
    .where(eq(tourStops.tourId, tourId))
    .orderBy(asc(layers.paletteSlot), asc(layers.slug))

  // Ordered so the artifact's hash does not depend on the plan's row order.
  // Two publishes of unchanged content must produce the same key, and
  // `hashArtifact` sorts object keys but not array elements.
  //
  // Slot then slug, because the slot alone is not a total order: nothing in
  // the schema stops two layers sharing one, and `import-layers` checks for a
  // collision only within a single directory, declining a unique index on
  // purpose so that two layers can swap slots without a temporary third value.
  // Two layers tied on slot would sort unstably and put the hash back where
  // the ordering was added to keep it from being.
  const layersByStop = new Map<string, string[]>()
  for (const row of stopLayerRows) {
    const list = layersByStop.get(row.stopId) ?? []
    list.push(row.slug)
    layersByStop.set(row.stopId, list)
  }

  /*
   * Rule 6 of the design, checked here rather than in `validateView`.
   *
   * In an artifact the stops are an ordered array and the ordinals are
   * implicit, so this is the last moment the numbering is still visible. A
   * hole means a stop was deleted without renumbering, and the artifact would
   * silently be a shorter tour than the one somebody authored.
   */
  stopRows.forEach((stop, index) => {
    if (stop.ordinal !== index + 1) {
      throw new Error(
        `tour "${tour.slug}" has a hole in its ordinals: expected ${index + 1}, found ${stop.ordinal}`,
      )
    }
  })

  const artifact = {
    id: tour.slug,
    regionSlug: tour.regionSlug,
    title: tour.title,
    subtitle: tour.subtitle,
    description: tour.description,
    estimatedMinutes: tour.estimatedMinutes,
    stops: stopRows.map((stop) => ({
      pack: stop.pack,
      year: stop.year,
      entityId: stop.entity,
      camera: stop.camera,
      layers: layersByStop.get(stop.id) ?? [],
      title: stop.title,
      locationLabel: stop.locationLabel,
      narration: stop.narration,
    })),
  }

  // Validate here, so an unpublishable artifact fails in the pipeline rather
  // than in a visitor's browser.
  return TourSchema.parse(artifact)
}
