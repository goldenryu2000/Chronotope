// A plain `tsx` invocation does not load .env.local on its own; this import
// must come first, before anything that touches `src/db/client`, because ESM
// evaluates every static import a module holds before that module's own
// top-level statements run. See scripts/load-env.ts for the full story.
import './load-env'

import { pathToFileURL } from 'node:url'
import { sql } from 'drizzle-orm'
import { db } from '../src/db/client'
import { boundaries, layers, packs, regions, tours } from '../src/db/schema'
import { publishLayer } from '../src/publish/publishLayer'
import { publishPack, publishRegion } from '../src/publish/publishPack'
import { publishTour } from '../src/publish/publishTour'
import { storageFromEnv } from '../src/publish/selectStorage'

/**
 * Regions that hold boundaries no archive has been cut from yet, by slug.
 *
 * The cold start runs `build-tiles` before `publish-all` for a reason:
 * `build-tiles` records `tileset_key` on the region, `publish-all` copies it
 * into the artifact, and `Atlas.tsx` will not build a map without it. In the
 * other order every command reports success and the atlas renders a timeline
 * over an empty page — a failure that names none of the six steps that
 * produced it.
 *
 * Bounded by the region's own bbox, matching how `build-tiles` clips: a region
 * is never asked to tile geometry that falls outside it. A region with no
 * boundaries at all is not listed — `import-legacy` runs before
 * `import-boundaries`, so that state is a normal intermediate one.
 */
export async function untiledRegions(): Promise<string[]> {
  const rows = await db
    .select({ slug: regions.slug })
    .from(regions)
    .where(sql`
      ${regions.tilesetKey} is null
      and exists (select 1 from ${boundaries} b where b.geom && ${regions.bbox})
    `)
  return rows.map((row) => row.slug)
}

async function run() {
  const storage = storageFromEnv(process.env)
  console.log(`Publishing to ${process.env.STORAGE ?? 'file'} storage`)

  const untiled = await untiledRegions()
  if (untiled.length > 0) {
    throw new Error(
      `these regions have boundaries but no tile archive: ${untiled.join(', ')}. `
      + 'Run `npx tsx scripts/build-tiles.ts <region>` first — publishing now '
      + 'would write an artifact with no tilesetKey, and the atlas draws no map '
      + 'without one.',
    )
  }

  // Every region, not just the one whose slug is 'world'. This script used to
  // select that slug by name, which meant a second region silently never got
  // an artifact and its atlas route 404'd with nothing to explain why. `world`
  // is a row like any other (Rule 3) — publish them all, the way packs
  // already were.
  const regionRows = await db.select().from(regions)
  if (regionRows.length === 0) {
    throw new Error('no regions found — run `npx tsx scripts/import-legacy.ts --all` first')
  }
  for (const region of regionRows) {
    const { key } = await publishRegion(region.id, storage)
    console.log(`Published region "${region.slug}" -> ${key}`)
  }

  const packRows = await db.select().from(packs)
  if (packRows.length === 0) {
    throw new Error('no packs found — run `npx tsx scripts/import-legacy.ts --all` first')
  }
  for (const pack of packRows) {
    const { key, version } = await publishPack(pack.id, storage)
    console.log(`Published pack "${pack.slug}" -> ${key} (version ${version})`)
  }

  /*
   * Layers before tours, because a tour stop that lights a layer is validated
   * against the *published* layer: rule 5 checks the layer draws in the stop's
   * year, and rule 7 checks the camera is over it. Publishing tours first
   * would refuse every stop with a layer on a cold database, which is a
   * correct refusal at the wrong moment.
   *
   * A database with no layers is not an error, for the reason a database with
   * no tours is not: `import-layers` is a step of its own and a cold start
   * that has not reached it yet is a normal intermediate state.
   */
  const layerRows = await db.select().from(layers)
  for (const layer of layerRows) {
    const { key } = await publishLayer(layer.id, storage)
    console.log(`Published layer "${layer.slug}" -> ${key}`)
  }

  /*
   * Tours last, because a tour is validated against published packs. Running
   * this before the loop above would refuse every cross-pack tour on a cold
   * database, which is a correct refusal at the wrong moment: the packs were
   * about to exist.
   *
   * A database with no tours is not an error. `import-legacy` and `seed-tours`
   * are separate steps, and a cold start that has run one but not the other is
   * a normal intermediate state.
   */
  const tourRows = await db.select().from(tours)
  for (const tour of tourRows) {
    const { key, version } = await publishTour(tour.id, storage)
    console.log(`Published tour "${tour.slug}" -> ${key} (version ${version})`)
  }
}

// Importing this file must not publish anything. Without the guard the module
// body ran on import and then closed the pool, which a test importing it
// discovers as `CONNECTION_ENDED` from an unrelated query. `build-tiles.ts`
// carries the same guard for the same reason.
const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  run()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    const client = db.$client
    await client.end()
  })
}
