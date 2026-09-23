import { db } from './client'
import { layers, packs, regions, tourStopLayers } from './schema'
import { importLayers } from '../../scripts/import-layers'
import { importPack, LEGACY_CONTENT_DIR } from '../../scripts/import-legacy'
import { importRegions } from '../../scripts/import-regions'

/**
 * Seeds the three legacy packs and, by default, every region under
 * `data/regions/` into the test database.
 *
 * Every region rather than just the world, because the committed tours are
 * authored against regions and `seedTours` refuses a tour whose region nobody
 * imported. A suite narrows the list only when the narrowing is what it is
 * testing.
 *
 * Vitest runs this repo's suites serially against one shared Postgres, and
 * file discovery order does not put `scripts/import-legacy.test.ts` first, so
 * a suite that needs content must seed it rather than hope. Every db-backed
 * test file here already does that; this exists because the tour suites need
 * *three* packs rather than one, and four copies of the same twelve lines is
 * worse than one import.
 *
 * Three packs, not one, because the tours cross packs. The flagship walks from
 * mythology into philosophy, and a single-pack fixture would make its whole
 * reason for existing untestable.
 *
 * **Packs before regions**, which is the order the cold start and `make
 * import` also run in: a region file names the packs laid over it, and
 * `importRegions` writes the `era_sets` row only for a pack that is already
 * there. Reversing the two leaves every plate with no packs on it and the
 * atlas route 404ing, which is a confusing way to fail a test about something
 * else.
 *
 * The layers come too, in the order the cold start documents: a committed stop
 * now names a road, and `seedTours` refuses one whose layer nobody imported.
 * Seeding packs without layers would fail four suites on a message about a
 * missing script rather than about anything they are testing.
 */
export async function seedRegionsAndPacks(
  regionSlugs?: readonly string[],
): Promise<void> {
  await db.delete(regions)
  await db.delete(packs)
  for (const pack of ['philosophy', 'mythology', 'creatures']) {
    await importPack(`${LEGACY_CONTENT_DIR}/${pack}`)
  }
  await importRegions(regionSlugs)
  await importLayers()
}

/**
 * Empties `layers`, for a suite that wants a clean table.
 *
 * Not a bare `db.delete(layers)`, which is what five suites used to do. The
 * committed tours light layers, `tour_stop_layers` holds that key
 * `on delete restrict`, and several suites seed those tours and leave them
 * behind. Whether a bare delete then worked depended on which suite ran just
 * before it, and Vitest orders files by the durations it cached last time, so
 * the suite passed on this machine and failed on a fresh clone with no cache.
 * Worse, it then passed the second time, because Vitest reruns failed files
 * first, so it would have looked like a flake.
 *
 * The join rows go first. The tours stay: a suite that needs them lit seeds
 * them itself, and deleting tours here would reach further than the name says.
 */
export async function deleteAllLayers(): Promise<void> {
  await db.delete(tourStopLayers)
  await db.delete(layers)
}
