/**
 * One-off: PhilMap's `OVERLAYS` array to `data/layers/*.json`.
 *
 * Committed rather than run and deleted, for the reason
 * `convert-legacy-tours.ts` is: the geometry is hand-authored content and
 * somebody will want to trace a coordinate back to where it came from.
 * Nothing imports this; it is not part of any pipeline.
 *
 * Run: npx tsx scripts/convert-legacy-overlays.ts <path-to-philmap>/src/data/overlays.ts
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LayerSchema } from '../src/data/schemas'

interface LegacyOverlay {
  id: string
  name: string
  kind: 'trade' | 'idea' | 'migration'
  colorToken: string
  activePeriod: [number, number]
  note: string
  geojson: { type: 'FeatureCollection'; features: unknown[] }
}

/**
 * Which palette slot each ported layer takes.
 *
 * Assigned here rather than derived from `colorToken`, because the mapping is
 * an editorial decision and not a rename: trade takes 1 to 5, ideas 6 and 7,
 * migrations 8 and 9, so no two layers of the same kind sit adjacent in hue
 * and the dash pattern is not the only thing telling them apart. The values
 * behind the slots are the ported colours, renamed in Task 1.
 */
const SLOTS: Record<string, number> = {
  'silk-road': 1,
  'spice-route': 2,
  'gold-road': 3,
  'incense-route': 4,
  'varangian-route': 5,
  alphabets: 6,
  buddhism: 7,
  'polynesian-voyaging': 8,
  'atlantic-passage': 9,
}

async function run() {
  const source = process.argv[2]
  if (!source) throw new Error('usage: convert-legacy-overlays.ts <overlays.ts>')

  const { OVERLAYS } = (await import(resolve(source))) as { OVERLAYS: LegacyOverlay[] }
  const out = join(process.cwd(), 'data', 'layers')
  await mkdir(out, { recursive: true })

  for (const legacy of OVERLAYS) {
    const slot = SLOTS[legacy.id]
    if (slot === undefined) throw new Error(`no palette slot assigned for "${legacy.id}"`)

    const layer = LayerSchema.parse({
      id: legacy.id,
      name: legacy.name,
      kind: legacy.kind,
      paletteSlot: slot,
      // `activePeriod` was inclusive at both ends and so is this. The
      // end-exclusive form belongs to the int4range column, and the importer
      // is where that conversion happens.
      valid: { start: legacy.activePeriod[0], end: legacy.activePeriod[1] },
      note: legacy.note,
      features: legacy.geojson,
    })

    await writeFile(join(out, `${layer.id}.json`), `${JSON.stringify(layer, null, 2)}\n`, 'utf8')
    console.log(`Wrote data/layers/${layer.id}.json (slot ${slot}, ${layer.features.features.length} legs)`)
  }
}

run().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
