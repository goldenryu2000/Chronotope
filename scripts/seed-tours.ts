import './load-env'

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { entities, layers, packs, regions, tourStopLayers, tourStops, tours } from '../src/db/schema'
import { TourSchema } from '../src/data/schemas'

/**
 * Reads `data/tours/` into the database, one transaction per tour.
 *
 * This is the stand-in for an authoring UI, and it is the only part of the
 * tour subsystem that authoring replaces: everything downstream of these rows
 * — validation, publishing, the read path, the player — is the same code a
 * reader's own tour will travel through.
 *
 * Deleting and re-inserting rather than diffing. A tour is small, the file is
 * the source of truth, and a partial update that left an orphaned stop behind
 * would be a bug that only shows up as a gap in someone's narration.
 */
export async function seedTours(dir = join(process.cwd(), 'data', 'tours')) {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  const seeded: { slug: string; stops: number }[] = []

  for (const file of files.sort()) {
    const tour = TourSchema.parse(JSON.parse(await readFile(join(dir, file), 'utf8')))

    const [region] = await db.select({ id: regions.id }).from(regions)
      .where(eq(regions.slug, tour.regionSlug))
    if (!region) throw new Error(`${file}: no region "${tour.regionSlug}"`)

    await db.transaction(async (tx) => {
      await tx.delete(tours).where(eq(tours.slug, tour.id))

      const [row] = await tx.insert(tours).values({
        slug: tour.id,
        regionId: region.id,
        title: tour.title,
        subtitle: tour.subtitle,
        description: tour.description,
        estimatedMinutes: tour.estimatedMinutes,
        // Ours, and readable now. A reader's tour will differ in exactly these
        // three columns and in nothing else.
        ownerId: null,
        visibility: 'official',
        status: 'published',
      }).returning()

      for (const [index, stop] of tour.stops.entries()) {
        const [pack] = await tx.select({ id: packs.id }).from(packs)
          .where(eq(packs.slug, stop.pack))
        if (!pack) throw new Error(`${file} stop ${index + 1}: no pack "${stop.pack}"`)

        let entityId: string | null = null
        if (stop.entityId) {
          const [entity] = await tx.select({ id: entities.id }).from(entities)
            .where(and(eq(entities.packId, pack.id), eq(entities.slug, stop.entityId)))
          if (!entity) {
            throw new Error(
              `${file} stop ${index + 1}: no entity "${stop.entityId}" in pack "${stop.pack}"`,
            )
          }
          entityId = entity.id
        }

        const [stopRow] = await tx.insert(tourStops).values({
          tourId: row.id,
          ordinal: index + 1,
          packId: pack.id,
          entityId,
          year: stop.year,
          camera: stop.camera,
          title: stop.title,
          locationLabel: stop.locationLabel,
          narration: stop.narration,
        }).returning()

        for (const slug of stop.layers) {
          const [layer] = await tx.select({ id: layers.id }).from(layers)
            .where(eq(layers.slug, slug))
          if (!layer) {
            throw new Error(
              `${file} stop ${index + 1}: no layer "${slug}". `
              + 'Run `npx tsx scripts/import-layers.ts` first: a stop naming a layer that '
              + 'is not imported would light nothing in the browser.',
            )
          }
          await tx.insert(tourStopLayers).values({ stopId: stopRow.id, layerId: layer.id })
        }
      }
    })

    seeded.push({ slug: tour.id, stops: tour.stops.length })
  }

  return seeded
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  seedTours()
    .then((seeded) => {
      for (const { slug, stops } of seeded) console.log(`Seeded tour "${slug}" — ${stops} stops`)
    })
    .catch((err) => { console.error(err); process.exitCode = 1 })
    .finally(async () => { await db.$client.end() })
}
