import { db } from './client'
import { layers, packs, regions, tourStopLayers } from './schema'
import { importLayers } from '../../scripts/import-layers'
import { importPack, importWorldRegion, LEGACY_CONTENT_DIR } from '../../scripts/import-legacy'

/**
 * Seeds the world region and all three legacy packs into the test database.
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
 * The layers come too, in the order the cold start documents: a committed stop
 * now names a road, and `seedTours` refuses one whose layer nobody imported.
 * Seeding packs without layers would fail four suites on a message about a
 * missing script rather than about anything they are testing.
 */
export async function seedWorldAndPacks(): Promise<void> {
  await db.delete(regions)
  await db.delete(packs)
  await importWorldRegion()
  for (const pack of ['philosophy', 'mythology', 'creatures']) {
    await importPack(`${LEGACY_CONTENT_DIR}/${pack}`, 'world')
  }
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

