import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { layerFeatures, layers } from '../db/schema'
import { type Layer, LayerSchema } from '../data/schemas'

/**
 * Layer rows to the artifact the browser reads.
 *
 * Geometry comes back through `ST_AsGeoJSON` because selecting the column bare
 * gives hex EWKB typed as a string; `src/db/types.ts` says so at length.
 */
export async function renderLayer(layerId: string): Promise<Layer> {
  const [layer] = await db
    .select({
      slug: layers.slug,
      name: layers.name,
      kind: layers.kind,
      paletteSlot: layers.paletteSlot,
      valid: layers.valid,
      note: layers.note,
    })
    .from(layers)
    .where(eq(layers.id, layerId))
  if (!layer) throw new Error(`no such layer: ${layerId}`)

  const featureRows = await db
    .select({
      name: layerFeatures.name,
      properties: layerFeatures.properties,
      geometry: sql<string>`ST_AsGeoJSON(${layerFeatures.geom})`,
    })
    .from(layerFeatures)
    .where(eq(layerFeatures.layerId, layerId))
    // By name, then by the geometry itself. Nothing makes a leg's name unique
    // within a layer, and two legs sharing one would otherwise come back in
    // whatever order the plan returned them, moving the artifact's hash for
    // unchanged content. The id is not the tiebreak: an import replaces the
    // legs and mints new ids, so ordering by it would move the hash on every
    // re-import instead. The geometry is what the leg is.
    .orderBy(asc(layerFeatures.name), sql`ST_AsGeoJSON(${layerFeatures.geom})`)

  if (featureRows.length === 0) {
    throw new Error(`layer "${layer.slug}" has no features, so it would light an empty map`)
  }

  return LayerSchema.parse({
    id: layer.slug,
    name: layer.name,
    kind: layer.kind,
    paletteSlot: layer.paletteSlot,
    // int4range is end-exclusive; the artifact's end is inclusive, the same
    // conversion renderRegion and renderPack make.
    valid: { start: layer.valid[0], end: layer.valid[1] - 1 },
    note: layer.note,
    features: {
      type: 'FeatureCollection',
      features: featureRows.map((row) => ({
        type: 'Feature',
        properties: { ...row.properties, name: row.name },
        geometry: JSON.parse(row.geometry) as { type: string; coordinates: unknown },
      })),
    },
  })
}
