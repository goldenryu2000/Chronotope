// A plain `tsx` invocation does not load .env.local on its own; this import
// must come first, before anything that touches `src/db/client`. See
// scripts/load-env.ts for the full story.
import './load-env'

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { eraSets, eras, packs, regions } from '../src/db/schema'
import { RegionDefinitionSchema, type Era, type RegionDefinition } from '../src/data/schemas'

/**
 * Where a region is authored. One file per plate, the way `data/tours/` and
 * `data/layers/` work, and for the same reason: this is the stand-in for an
 * authoring UI, and every row it writes is a row a reader's own region would
 * travel through.
 */
export const REGION_DIR = join(process.cwd(), 'data', 'regions')

/** The type `tx` has inside a `db.transaction(async (tx) => ...)` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface RegionImportResult {
  slug: string
  eras: number
  /** Packs laid over this region, by slug. */
  packs: string[]
  /** Packs the file named that the database has not got. See `importRegion`. */
  missingPacks: string[]
}

/** Reads and validates every region definition, keyed by slug. */
export function readRegionDefinitions(dir = REGION_DIR): Map<string, RegionDefinition> {
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  const found = new Map<string, RegionDefinition>()

  for (const file of files) {
    const raw: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const result = RegionDefinitionSchema.safeParse(raw)
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
      throw new Error(`${file}: not a region definition: ${issues}`)
    }
    const region = result.data
    // The slug is the address (`/<region>/<pack>`), so two files claiming one
    // would make which plate answers that address depend on directory order.
    const previous = found.get(region.id)
    if (previous) throw new Error(`${file}: region "${region.id}" is already defined in another file`)
    found.set(region.id, region)
  }

  return found
}

/**
 * Parents before children, refusing a cycle or a parent nobody defined.
 *
 * The insert order matters for one reason only: `parent_id` is a foreign key
 * to a row in the same table, so a child inserted first has nothing to point
 * at. Kahn's algorithm rather than a sort by depth, because the thing that
 * actually has to be refused is a cycle, and a topological sort is the one
 * that notices: India naming Northern India as its parent while Northern India
 * names India would otherwise recurse until the stack ran out.
 */
export function orderByDepth(defs: Map<string, RegionDefinition>): RegionDefinition[] {
  const ordered: RegionDefinition[] = []
  const placed = new Set<string>()

  for (const region of defs.values()) {
    if (region.parent && !defs.has(region.parent)) {
      throw new Error(
        `region "${region.id}" names parent "${region.parent}", which no file in `
        + `${REGION_DIR} defines.`,
      )
    }
  }

  let progress = true
  while (progress) {
    progress = false
    for (const region of defs.values()) {
      if (placed.has(region.id)) continue
      if (region.parent && !placed.has(region.parent)) continue
      ordered.push(region)
      placed.add(region.id)
      progress = true
    }
  }

  if (ordered.length !== defs.size) {
    const stuck = [...defs.keys()].filter((slug) => !placed.has(slug)).sort()
    throw new Error(`regions form a parent cycle: ${stuck.join(', ')}`)
  }

  return ordered
}

function bboxPolygon([west, south, east, north]: readonly number[]): string {
  return `SRID=4326;POLYGON((${west} ${south},${east} ${south},${east} ${north},`
    + `${west} ${north},${west} ${south}))`
}

async function insertEras(
  tx: Tx, eraSetId: string, list: readonly Era[],
): Promise<void> {
  if (list.length === 0) return
  await tx.insert(eras).values(
    list.map((era, i) => ({
      eraSetId,
      slug: era.id,
      label: era.label,
      start: era.start,
      end: era.end,
      weight: era.weight,
      blurb: era.blurb,
      ordinal: i,
    })),
  )
}

/**
 * Write one region definition, its default periodization, and the `era_sets`
 * rows that lay its packs over it.
 *
 * Replaces rather than diffs, the way `seed-tours` does: the file is the source
 * of truth, a region is a handful of rows, and a partial update that left an
 * era behind would show up as a wrong label under a reader's cursor rather
 * than as an error anyone could act on.
 *
 * Deleting the region cascades to its era sets (and so to a placement, and to
 * that set's eras) and to any tour authored on it. A tour is re-seeded from
 * `data/tours/` by a later step of the same import, which is why `make import`
 * and the cold start run this before `seed-tours` rather than after.
 *
 * **A pack the file names but the database has not got is reported, not
 * thrown on.** Both halves matter. Importing packs is a separate step, so a
 * cold start that has not reached it is a normal intermediate state and a
 * throw here would make the two scripts un-runnable in either order; but a
 * misspelled slug would otherwise leave a plate quietly missing a pack, with
 * nothing anywhere to say why. So the placement is skipped, the slug comes
 * back in `missingPacks`, and the CLI below prints it and exits non-zero.
 */
export async function importRegion(
  region: RegionDefinition, parentId: string | null,
): Promise<RegionImportResult> {
  return db.transaction(async (tx) => {
    await tx.delete(regions).where(eq(regions.slug, region.id))

    const [row] = await tx.insert(regions).values({
      slug: region.id,
      title: region.title,
      subtitle: region.subtitle,
      bbox: bboxPolygon(region.bbox),
      minZoom: region.minZoom,
      maxZoom: region.maxZoom,
      defaultCamera: region.defaultCamera,
      // int4range is end-exclusive; the authored `end` is the last year covered.
      range: [region.range.start, region.range.end + 1],
      theme: region.theme,
      parentId,
      // Ours, and readable now. A reader's own plate will differ in exactly
      // these three columns and in nothing else.
      ownerId: null,
      visibility: 'official',
      status: 'published',
    }).returning()

    const [defaultSet] = await tx.insert(eraSets)
      .values({ regionId: row.id, packId: null })
      .returning()
    await insertEras(tx, defaultSet.id, region.eras)

    const placed: string[] = []
    const missing: string[] = []

    for (const entry of region.packs) {
      const slug = entry.slug
      const [pack] = await tx.select({ id: packs.id }).from(packs).where(eq(packs.slug, slug))
      if (!pack) {
        missing.push(slug)
        continue
      }
      /*
       * The placement, and its override if the file gave one.
       *
       * An era set carrying rows is an *override*: that pack's editorial view
       * of this region's shape of time, which is what the two myth packs have
       * on `world`. A set with no rows says only "this pack is laid over this
       * plate", and the timeline then runs on the region's own periodization.
       * That is the right default for a new plate: India's centuries are
       * India's, not the philosophy pack's view of everyone's.
       *
       * `renderPack` omits an empty set from `eraOverrides` for exactly that
       * reason, and `resolveEras` treats an empty one as absent. Both, because
       * an artifact published before that fix still has to read correctly.
       */
      const [set] = await tx.insert(eraSets)
        .values({ regionId: row.id, packId: pack.id })
        .returning()
      await insertEras(tx, set.id, entry.eras)
      placed.push(slug)
    }

    return { slug: region.id, eras: region.eras.length, packs: placed, missingPacks: missing }
  })
}

/**
 * Read `data/regions/` into the database.
 *
 * `only` narrows to a subset by slug, which is what the test suites use: a
 * suite that needs a world to hang a boundary off does not need every plate in
 * the repository. A named region still brings its ancestors, because
 * `parent_id` is a foreign key and a plate with a dangling parent is not a row
 * Postgres will accept.
 */
export async function importRegions(
  only?: readonly string[], dir = REGION_DIR,
): Promise<RegionImportResult[]> {
  const defs = readRegionDefinitions(dir)

  let wanted = defs
  if (only) {
    wanted = new Map()
    const queue = [...only]
    while (queue.length > 0) {
      const slug = queue.pop() as string
      if (wanted.has(slug)) continue
      const region = defs.get(slug)
      if (!region) throw new Error(`no region definition for "${slug}" in ${dir}`)
      wanted.set(slug, region)
      if (region.parent) queue.push(region.parent)
    }
  }

  const results: RegionImportResult[] = []
  const idBySlug = new Map<string, string>()

  for (const region of orderByDepth(wanted)) {
    const parentId = region.parent ? idBySlug.get(region.parent) ?? null : null
    results.push(await importRegion(region, parentId))
    const [row] = await db.select({ id: regions.id }).from(regions)
      .where(eq(regions.slug, region.id))
    idBySlug.set(region.id, row.id)
  }

  return results
}

// Importing this file must not import anything into the database. Without the
// guard the module body ran on import and then closed the pool, which a test
// importing it discovers as `CONNECTION_ENDED` from an unrelated query.
const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const run = async () => {
    const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
    const results = await importRegions(only.length > 0 ? only : undefined)
    for (const result of results) {
      console.log(
        `Imported region "${result.slug}": ${result.eras} eras, `
        + `${result.packs.length > 0 ? result.packs.join(', ') : 'no packs'}.`,
      )
    }

    const missing = results.filter((result) => result.missingPacks.length > 0)
    if (missing.length > 0) {
      for (const result of missing) {
        console.error(
          `  region "${result.slug}" names ${result.missingPacks.join(', ')}, `
          + 'which no imported pack answers to.',
        )
      }
      throw new Error(
        'Some packs named by a region are not in the database. Run '
        + '`npx tsx scripts/import-legacy.ts --all` before this, or fix the slug in '
        + 'the region file: a plate is offered through its packs, so a region that '
        + 'places none of them is a region nothing links to.',
      )
    }
  }

  run()
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(async () => {
      await db.$client.end()
    })
}
