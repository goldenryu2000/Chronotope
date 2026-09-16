import './load-env'

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { db } from '../src/db/client'
import { layerFeatures, layers } from '../src/db/schema'
import { LayerSchema } from '../src/data/schemas'

/**
 * Reads `data/layers/` into the database, one transaction per layer.
 *
 * The stand-in for an authoring UI, exactly as `seed-tours.ts` is, and the
 * only part of the layer subsystem authoring replaces: publishing, the read
 * path, the menu and the map are the same code a reader's own layer will
 * travel through.
 *
 * The row is updated in place and its legs are replaced wholesale, rather than
 * diffed. The file is the source of truth, and a partial update leaving an
 * orphaned leg behind is a bug that only shows up as a gap in a line somebody
 * drew. The row itself is not deleted, because a tour stop may be pointing at
 * it: see the transaction below.
 */
/**
 * Refuses a leg the map and the validator would both get wrong.
 *
 * Coordinates outside longitude -180..180 or latitude -90..90 are refused, and
 * so is a leg that jumps more than 180 degrees of longitude between two
 * consecutive points. That second shape is how a line crossing the antimeridian
 * gets written (174 then -172), and it is wrong twice over: the atlas does not
 * repeat the world, so it draws the long way round, across every continent;
 * and the leg's bounding box spans nearly the whole globe, so validator rule 7,
 * which checks a stop's camera against that box, would accept a camera almost
 * anywhere. No shipped layer crosses the line. This keeps it that way until
 * someone decides deliberately how one should.
 */
export function refuseUnsafeGeometry(file: string, legName: string, geometry: unknown): void {
  const lines: number[][][] = []
  const shape = geometry as { type?: string; coordinates?: unknown }
  if (shape.type === 'LineString') lines.push(shape.coordinates as number[][])
  else if (shape.type === 'MultiLineString') lines.push(...(shape.coordinates as number[][][]))
  else throw new Error(`${file}: leg "${legName}" is a ${shape.type}, and a layer draws only lines`)

  for (const line of lines) {
    for (const [index, point] of line.entries()) {
      const [lng, lat] = point
      if (!(lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90)) {
        throw new Error(`${file}: leg "${legName}" has a point outside the world at ${lng}, ${lat}`)
      }
      const previous = line[index - 1]
      if (previous && Math.abs(lng - previous[0]) > 180) {
        throw new Error(
          `${file}: leg "${legName}" jumps from longitude ${previous[0]} to ${lng}, `
          + 'which crosses the antimeridian. Split the leg at 180 degrees into two.',
        )
      }
    }
  }
}

export async function importLayers(dir = join(process.cwd(), 'data', 'layers')) {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'))
  const imported: { slug: string; features: number }[] = []

  /*
   * Two layers on one slot draw in the same colour, and the dash pattern only
   * separates them when their kinds differ. Caught across the whole directory
   * rather than per file, because the collision is between files by
   * definition. A unique index would say the same thing, and would also make
   * swapping two layers' slots impossible without a temporary third value.
   */
  const takenSlots = new Map<number, string>()

  for (const file of files.sort()) {
    const layer = LayerSchema.parse(JSON.parse(await readFile(join(dir, file), 'utf8')))

    const holder = takenSlots.get(layer.paletteSlot)
    if (holder) {
      throw new Error(
        `${file}: palette slot ${layer.paletteSlot} is already taken by "${holder}". `
        + 'Two layers on one slot draw in the same colour.',
      )
    }
    takenSlots.set(layer.paletteSlot, layer.id)

    // Checked before the transaction opens, so a bad leg writes nothing at all
    // rather than rolling back a layer that was half replaced.
    for (const [index, feature] of layer.features.features.entries()) {
      const name = (feature.properties as { name?: unknown } | null)?.name
      refuseUnsafeGeometry(file, typeof name === 'string' && name ? name : `leg ${index + 1}`, feature.geometry)
    }

    await db.transaction(async (tx) => {
      /*
       * Updated in place, not deleted and reinserted.
       *
       * The delete-then-insert this used to do was refused the moment a tour
       * stop named a layer: `tour_stop_layers` references the row with
       * `on delete restrict`, deliberately, so that removing a layer cannot
       * quietly rewrite a published tour into one narrating a route nobody can
       * see. Re-importing is not removing, and it should not have to argue
       * with a constraint that is protecting something else.
       *
       * It also keeps the uuid stable across imports, which is the honest
       * model: the slug is the layer's identity, and re-reading its file is
       * new content for the same layer rather than a different layer wearing
       * the same name.
       */
      const [row] = await tx.insert(layers).values({
        slug: layer.id,
        name: layer.name,
        kind: layer.kind,
        paletteSlot: layer.paletteSlot,
        // The file's `valid.end` is inclusive; the column is not.
        valid: [layer.valid.start, layer.valid.end + 1],
        note: layer.note,
        // Ours, and readable now. A reader's layer will differ in exactly
        // these three columns and in nothing else.
        ownerId: null,
        visibility: 'official',
        status: 'published',
      }).onConflictDoUpdate({
        target: layers.slug,
        set: {
          name: layer.name,
          kind: layer.kind,
          paletteSlot: layer.paletteSlot,
          valid: [layer.valid.start, layer.valid.end + 1],
          note: layer.note,
          // Re-asserted, as the delete-and-insert this replaced did by
          // construction. A layer moved to draft by hand comes back published
          // when its file is re-read, because the file is what says so.
          visibility: 'official',
          status: 'published',
        },
        // Only ever over an official row. Slugs are unique across everyone,
        // so a reader's own layer could one day share a name with a file here,
        // and an import must refuse that rather than rewrite it while leaving
        // it owned by the reader.
        setWhere: sql`${layers.ownerId} is null`,
      }).returning()

      if (!row) {
        throw new Error(
          `${file}: a layer called "${layer.id}" already exists and belongs to a reader. `
          + 'An import only replaces official layers; rename this file\'s id.',
        )
      }

      // The legs are replaced wholesale, which is what makes a re-import a
      // re-import: a file that dropped a leg must not leave it on the map.
      await tx.delete(layerFeatures).where(eq(layerFeatures.layerId, row.id))

      for (const [index, feature] of layer.features.features.entries()) {
        const { name, ...rest } = (feature.properties ?? {}) as Record<string, unknown>
        await tx.insert(layerFeatures).values({
          layerId: row.id,
          name: typeof name === 'string' && name.length > 0 ? name : `leg ${index + 1}`,
          // Through PostGIS rather than a WKT writer of our own: one parser,
          // and `ST_Multi` removes the need to branch on how many parts a leg
          // has.
          geom: sql`ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(feature.geometry)})), 4326)`,
          properties: rest,
        })
      }
    })

    imported.push({ slug: layer.id, features: layer.features.features.length })
  }

  return imported
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  importLayers()
    .then((rows) => {
      for (const row of rows) console.log(`Imported layer "${row.slug}" (${row.features} legs)`)
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(async () => {
      await db.$client.end()
    })
}
