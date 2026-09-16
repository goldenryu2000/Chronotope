import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
// Side-effect import, must precede `db`: see load-env.ts for why loading
// .env.local from within this file, after the db import, would be too late.
import './load-env'
import { db } from '../src/db/client'
import {
  entities, entityTraditions, eraSets, eras, packs, regions, traditions,
} from '../src/db/schema'
import { EntitySchema, EraSchema, TraditionSchema } from '../src/data/schemas'
import type { Entity, Era, Tradition } from '../src/data/schemas'

const WORLD_BBOX = 'SRID=4326;POLYGON((-180 -85,180 -85,180 85,-180 85,-180 -85))'

/**
 * The previous static build's content directory, one pack per subfolder.
 * A machine-specific absolute path, so it comes only from LEGACY_CONTENT_DIR
 * and has no default: a fallback baked into the source would be one
 * machine's layout, and on any other machine it fails later and less clearly
 * than this. Used by both importWorldRegion (which only needs philosophy's
 * manifest) and the CLI below.
 */
export const LEGACY_CONTENT_DIR = requireLegacyContentDir()

function requireLegacyContentDir(): string {
  const dir = process.env.LEGACY_CONTENT_DIR
  if (!dir) {
    throw new Error(
      'LEGACY_CONTENT_DIR is not set. Point it at the previous build\'s content directory '
      + '(one folder per pack); see .env.example.',
    )
  }
  return dir
}

/** The type `tx` has inside a `db.transaction(async (tx) => ...)` callback. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Parses `raw` through `schema`, throwing on failure with enough context to
 * act on: which pack, which item, and the Zod issue path — a bare ZodError
 * says "something in this array is wrong" and sends you back to the code to
 * find out what. Items are named by their own `id` where that parsed cleanly;
 * if the failure is ON the id field itself, the id is exactly the thing not
 * to be trusted, so the item's index in the source array is used instead.
 */
function parseOrThrow<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  pack: string,
  kind: string,
  index: number,
): T {
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  const idIsTheProblem = result.error.issues.some((issue) => issue.path[0] === 'id')
  const maybeId = (raw as { id?: unknown } | null)?.id
  const label = !idIsTheProblem && typeof maybeId === 'string'
    ? `"${maybeId}"`
    : `at index ${index}`
  const issues = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
  throw new Error(`pack "${pack}": ${kind} ${label} failed validation: ${issues}`)
}

export async function importWorldRegion(): Promise<void> {
  const manifest = JSON.parse(
    readFileSync(`${LEGACY_CONTENT_DIR}/philosophy/manifest.json`, 'utf8'),
  )
  const validatedEras: Era[] = (manifest.eras ?? []).map(
    (era: unknown, i: number) => parseOrThrow(EraSchema, era, 'world (seeded from philosophy)', 'era', i),
  )

  // Wrapped in a transaction for the same reason importPack is: the region,
  // its default era set and that set's eras are three separate statements,
  // and a failure partway through must not leave a region with no eras (or
  // no default era set at all) sitting in the database.
  await db.transaction(async (tx) => {
    const [world] = await tx.insert(regions).values({
      slug: 'world',
      title: 'World',
      subtitle: 'everywhere, all of it',
      bbox: WORLD_BBOX,
      minZoom: 0,
      maxZoom: 6,
      defaultCamera: { center: [20, 25], zoom: 1.6 },
      range: [-4000, 2027],
      theme: 'rustic',
      visibility: 'official',
      status: 'published',
    }).returning()

    /**
     * The world's default periodization is seeded from philosophy's eleven eras
     * — the most developed of the three legacy packs. Arbitrary but defensible;
     * it is editable content, not a structural claim.
     */
    const [set] = await tx.insert(eraSets)
      .values({ regionId: world.id, packId: null })
      .returning()
    await insertEras(tx, set.id, validatedEras)
  })
}

async function insertEras(tx: Tx, eraSetId: string, list: Era[]) {
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

export async function importPack(dir: string, regionSlug: string) {
  const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'))
  const rawList = JSON.parse(readFileSync(`${dir}/entities.json`, 'utf8'))

  // Validated before any statement runs, against the same Zod contract the
  // rest of the app trusts (Task 2's PackSchema family) — not PackSchema
  // itself, since the legacy manifest and entities.json are split across two
  // files and the manifest's tradition field is `region`, not `regionLabel`.
  const validatedTraditions: Tradition[] = (manifest.traditions ?? []).map(
    (t: { id: string; label: string; region: string }, i: number) => parseOrThrow(
      TraditionSchema,
      { id: t.id, label: t.label, regionLabel: t.region },
      manifest.id,
      'tradition',
      i,
    ),
  )
  const validatedEntities: Entity[] = rawList.map(
    (e: unknown, i: number) => parseOrThrow(EntitySchema, e, manifest.id, 'entity', i),
  )
  const validatedEras: Era[] = (manifest.eras ?? []).map(
    (era: unknown, i: number) => parseOrThrow(EraSchema, era, manifest.id, 'era', i),
  )

  // Everything below is one transaction: a pack, its traditions, its
  // entities, its entity-tradition links and its era-set override either all
  // land, or none of them do. Without this, the unknown-tradition throw
  // partway through the entity loop (or any insert failure) would leave a
  // pack row with some fraction of its entities and no era override, and
  // nothing downstream would know it was incomplete.
  return db.transaction(async (tx) => {
    const [pack] = await tx.insert(packs).values({
      slug: manifest.id,
      title: manifest.title,
      subtitle: manifest.subtitle,
      spanLabel: manifest.spanLabel,
      activeOffset: manifest.activeOffset ?? 0,
      range: [manifest.range.start, manifest.range.end + 1],
      startYear: manifest.startYear,
      visibility: 'official',
      status: 'published',
    }).returning()

    const traditionRows = validatedTraditions.length
      ? await tx.insert(traditions).values(
        validatedTraditions.map((t) => ({
          packId: pack.id,
          slug: t.id,
          label: t.label,
          regionLabel: t.regionLabel,
        })),
      ).returning()
      : []
    const traditionBySlug = new Map(traditionRows.map((t) => [t.slug, t.id]))

    for (const e of validatedEntities) {
      const [row] = await tx.insert(entities).values({
        packId: pack.id,
        slug: e.id,
        name: e.name,
        // int4range is end-exclusive; the legacy `end` is inclusive.
        span: [e.start, e.end + 1],
        fuzzy: Boolean(e.fuzzy),
        point: `SRID=4326;POINT(${e.lng} ${e.lat})`,
        place: e.place,
        tier: e.tier,
        blurb: e.blurb,
        ideas: e.ideas ?? [],
        wikipedia: e.wikipedia,
        wikidata: e.wikidata,
        image: e.image ?? null,
      }).returning()

      // Unknown tradition slugs are thrown on, not silently dropped: this is
      // exactly the class of bug the project design calls out by name — a
      // well-typed string that is still wrong. The old build shipped four
      // tour steps pointing at ids that existed in no pack, and typecheck,
      // lint and build all passed anyway. Today's legacy data is clean, so
      // this should never fire; if it does, the transaction above ensures
      // the partial pack it fired inside of never gets committed.
      const links = e.traditions.map((slug) => {
        const traditionId = traditionBySlug.get(slug)
        if (!traditionId) {
          throw new Error(
            `pack "${manifest.id}": entity "${e.id}" references unknown tradition "${slug}"`,
          )
        }
        return { entityId: row.id, traditionId }
      })
      if (links.length) await tx.insert(entityTraditions).values(links)
    }

    const [region] = await tx.select().from(regions).where(eq(regions.slug, regionSlug))
    const [set] = await tx.insert(eraSets)
      .values({ regionId: region.id, packId: pack.id })
      .returning()
    await insertEras(tx, set.id, validatedEras)

    return { entities: validatedEntities.length, eras: validatedEras.length }
  })
}

// CLI entry point. Guarded so importing this module (e.g. from the test file)
// never triggers a real import against the database.
const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const run = async () => {
    if (process.argv.includes('--all')) {
      // Destructive by design, and unscoped: `regions` and `packs` are
      // cleared in full, cascading to era sets, entities, traditions and
      // links, not just the `world` region and these three legacy packs.
      // That is what makes a re-run start clean instead of dying on unique
      // constraints. Harmless today — this database holds nothing else yet
      // — but regions and packs become user-owned in a later milestone, at
      // which point this would delete other people's content too.
      await db.delete(regions)
      await db.delete(packs)

      await importWorldRegion()
      const philosophy = await importPack(`${LEGACY_CONTENT_DIR}/philosophy`, 'world')
      const mythology = await importPack(`${LEGACY_CONTENT_DIR}/mythology`, 'world')
      const creatures = await importPack(`${LEGACY_CONTENT_DIR}/creatures`, 'world')
      console.log(
        'Imported onto world: '
        + `philosophy (${philosophy.entities} entities, ${philosophy.eras} eras), `
        + `mythology (${mythology.entities} entities, ${mythology.eras} eras), `
        + `creatures (${creatures.entities} entities, ${creatures.eras} eras).`,
      )
    } else {
      console.log('Usage: tsx scripts/import-legacy.ts --all')
    }
  }

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
