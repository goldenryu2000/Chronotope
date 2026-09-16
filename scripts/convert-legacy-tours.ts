/**
 * One-off: PhilMap's `TOURS` array to `data/tours/*.json`.
 *
 * Committed rather than run and deleted, because the six tours' narration is
 * content someone will want to trace back to its source. Not part of any
 * pipeline; nothing imports it.
 *
 * Run: npx tsx scripts/convert-legacy-tours.ts <path-to-philmap>/src/tours/tourData.ts
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { TourSchema } from '../src/data/schemas'

interface LegacyStep {
  pack: string; year: number; entityId: string; title: string
  locationLabel: string; narration: string; center: [number, number]; zoom: number
}
interface LegacyTour {
  id: string; title: string; subtitle: string; description: string
  estimatedTime: string; steps: LegacyStep[]
}

async function run() {
  const source = process.argv[2]
  if (!source) throw new Error('usage: convert-legacy-tours.ts <tourData.ts>')

  const { TOURS } = (await import(resolve(source))) as { TOURS: LegacyTour[] }
  const out = join(process.cwd(), 'data', 'tours')
  await mkdir(out, { recursive: true })

  for (const legacy of TOURS) {
    const minutes = Number(/(\d+)/.exec(legacy.estimatedTime)?.[1])
    if (!Number.isFinite(minutes)) throw new Error(`unparseable time: ${legacy.estimatedTime}`)

    const tour = TourSchema.parse({
      id: legacy.id,
      // Every legacy tour was authored against the world map; there was no
      // other region to author against.
      regionSlug: 'world',
      title: legacy.title,
      subtitle: legacy.subtitle,
      description: legacy.description,
      estimatedMinutes: minutes,
      stops: legacy.steps.map((step) => ({
        pack: step.pack,
        year: step.year,
        entityId: step.entityId,
        camera: { center: step.center, zoom: step.zoom },
        layers: [],
        title: step.title,
        locationLabel: step.locationLabel,
        narration: step.narration,
      })),
    })

    await writeFile(join(out, `${tour.id}.json`), `${JSON.stringify(tour, null, 2)}\n`, 'utf8')
    console.log(`Wrote data/tours/${tour.id}.json — ${tour.stops.length} stops`)
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1 })
