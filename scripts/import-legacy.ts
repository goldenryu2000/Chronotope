import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import type { z } from 'zod'
// Side-effect import, must precede `db`: see load-env.ts for why loading
// .env.local from within this file, after the db import, would be too late.
import './load-env'
import { db } from '../src/db/client'
import { entities, entityTraditions, packs, tours, traditions } from '../src/db/schema'
import { EntitySchema, TraditionSchema } from '../src/data/schemas'
import type { Entity, Tradition } from '../src/data/schemas'

/**
 * The previous static build's content directory, one pack per subfolder.
 * A machine-specific absolute path, so it comes only from LEGACY_CONTENT_DIR
 * and has no default: a fallback baked into the source would be one
 * machine's layout, and on any other machine it fails later and less clearly
 * than this. Read by `importPack` through the CLI below, and by the test
 * suites that import content for real.
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

export async function importPack(dir: string) {
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
  // Everything below is one transaction: a pack, its traditions, its entities
  // and its entity-tradition links either all land, or none of them do.
  // Without this, the unknown-tradition throw partway through the entity loop
  // (or any insert failure) would leave a pack row with some fraction of its
  // entities, and nothing downstream would know it was incomplete.
  //
  // Where the pack is *laid* is not written here. `era_sets` is the row that
  // says "this pack is on this region", and `scripts/import-regions.ts` is its
  // one author: a region declares what it offers, because the same pack is
  // read at world scale and at regional scale and neither placement belongs to
  // the pack's own import.
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

    return { entities: validatedEntities.length }
  })
}

// CLI entry point. Guarded so importing this module (e.g. from the test file)
// never triggers a real import against the database.
const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const run = async () => {
    if (process.argv.includes('--all')) {
      // Destructive by design, and unscoped: `packs` is cleared in full,
      // cascading to entities, traditions, links and every `era_sets` row that
      // placed one of them on a region. That is what makes a re-run start
      // clean instead of dying on unique constraints. Harmless today — this
      // database holds nothing else yet — but packs become user-owned in a
      // later milestone, at which point this would delete other people's
      // content too.
      //
      // `regions` is deliberately *not* cleared here any more. A region is no
      // longer a thing this script invents; it is a file under `data/regions/`
      // and `scripts/import-regions.ts` owns it. Clearing regions here would
      // destroy the placements that script wrote, from a script that could not
      // put them back.
      //
      // `tours` is, and has to be: `tour_stops.pack_id` is a plain foreign key
      // with no cascade, so Postgres refuses to drop a pack a stop still names.
      // That refusal is right — it is the same key that makes a misspelled
      // entity unwritable — and re-importing every pack from nothing does
      // genuinely invalidate every tour, so this deletes them and
      // `scripts/seed-tours.ts` puts them back. Until this line existed the
      // work was done by `delete(regions)` cascading, which is a surprising
      // way for a pack import to have been getting its way.
      await db.delete(tours)
      await db.delete(packs)

      const philosophy = await importPack(`${LEGACY_CONTENT_DIR}/philosophy`)
      const mythology = await importPack(`${LEGACY_CONTENT_DIR}/mythology`)
      const creatures = await importPack(`${LEGACY_CONTENT_DIR}/creatures`)
      console.log(
        `Imported philosophy (${philosophy.entities} entities), `
        + `mythology (${mythology.entities} entities), `
        + `creatures (${creatures.entities} entities). `
        + 'Run `npx tsx scripts/import-regions.ts` next to lay them over a region.',
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
