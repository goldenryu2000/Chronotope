import { db } from '../db/client'
import { layers, packs, tours } from '../db/schema'
import { publishLayer } from '../publish/publishLayer'
import { publishPack } from '../publish/publishPack'
import { publishTour } from '../publish/publishTour'
import { fileStorage } from '../publish/storage'

/**
 * Publishes every seeded pack and tour to `public/artifacts/`, for suites that
 * exercise the read path rather than the write path.
 *
 * `fileStorage`, not `memoryStorage`: the read path resolves URLs against what
 * a browser could actually fetch, and a pointer to an object that only ever
 * existed in a Map is the exact failure `currentArtifact.ts` exists to surface.
 *
 * Packs and layers first. A tour is validated against published packs, and a
 * stop that lights a layer against the published layer, and refuses otherwise,
 * which is the right behaviour and the wrong order to discover it in.
 *
 * The layers were missing here once, and the suite passed anyway whenever an
 * earlier suite had happened to leave them published. Shuffling file order
 * failed it three seeds out of five. `publish-all` does the same three steps in
 * the same order.
 */
export async function publishAllTours(): Promise<void> {
  const storage = fileStorage()
  for (const pack of await db.select().from(packs)) await publishPack(pack.id, storage)
  for (const layer of await db.select().from(layers)) await publishLayer(layer.id, storage)
  for (const tour of await db.select().from(tours)) await publishTour(tour.id, storage)
}
