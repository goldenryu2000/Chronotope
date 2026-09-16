import { desc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { packVersions, packs, regions, tourVersions, tours } from '../db/schema'
import type { Pack } from '../data/schemas'
import { type LayerBounds, validateTour } from '../tours/validateView'
import { artifactKey, hashArtifact } from './hash'
import { renderPack } from './renderPack'
import { renderRegion } from './renderRegion'
import { renderTour } from './renderTour'
import type { Storage } from './storage'

/**
 * Publishes a tour, or refuses and says which stop was wrong.
 *
 * The refusal is the point. The ported build shipped four broken stops out of
 * twenty-eight and every one of them passed lint, typecheck and build: a stop
 * that selects nobody is data, and a type checker cannot see data. Validating
 * here means an unpublishable tour cannot reach an artifact at all, which is
 * strictly stronger than a test that has to be remembered and run.
 *
 * Validated against what is *published*, not against what is in the database.
 * A stop is honest if the reader's browser can render it, and the reader's
 * browser only ever sees artifacts.
 */
export async function publishTour(tourId: string, storage: Storage) {
  const artifact = await renderTour(tourId)

  const [region] = await db.select({ id: regions.id }).from(regions)
    .where(eq(regions.slug, artifact.regionSlug))
  if (!region) throw new Error(`tour "${artifact.id}": no region "${artifact.regionSlug}"`)

  const rendered = new Map<string, Pack>()
  for (const slug of new Set(artifact.stops.map((stop) => stop.pack))) {
    const [row] = await db
      .select({ id: packs.id })
      .from(packs)
      .innerJoin(packVersions, eq(packs.currentVersionId, packVersions.id))
      .where(eq(packs.slug, slug))
    if (!row) {
      throw new Error(
        `tour "${artifact.id}" visits pack "${slug}", which has no published version. `
        + 'Run `npx tsx scripts/publish-all.ts` in order, or publish that pack first: a '
        + 'tour stop pointing into an unpublished pack selects nobody in the browser.',
      )
    }
    rendered.set(slug, await renderPack(row.id))
  }

  /*
   * Every layer this tour's readers could actually be shown, by slug: the
   * years it draws and the rectangle it draws them in. Rules 5 and 7 are both
   * inert without this, and a stop naming a layer would have been refused
   * outright.
   *
   * The predicate is `layersOnRegion`'s, deliberately, because that function
   * is what the reader's browser is offered and `Atlas` resolves a lit slug
   * against it. Validating against a looser set would let a stop light a
   * layer the browser will never hold: one whose `status` went back to draft
   * while keeping its artifact key, which `publishLayer` allows because it
   * sets the key and never touches the status, or one whose geometry does not
   * reach this region at all. Either draws nothing, silently, which is the
   * failure these rules exist to catch.
   *
   * Raw SQL, and one statement for every layer at once, because the
   * alternative is `renderLayer` per layer: that runs `ST_AsGeoJSON` over
   * every leg of every route, so that a walk over the coordinates can reduce
   * them back down to four numbers. PostGIS already has those four numbers.
   * `publish-all` publishes six tours over nine layers, so the difference is
   * fifty-four full geometry renders against six cheap statements.
   *
   * `upper(valid) - 1` is the same end-exclusive to end-inclusive conversion
   * `renderLayer` and `layersOnRegion` make. `st_xmin`/`st_ymin`/`st_xmax`/
   * `st_ymax` are read west, south, east, north, which is the order rule 7
   * indexes, the order `renderRegion` reads a region's own bbox in, and the
   * order a camera centre is written in: longitude first.
   *
   * `on e.ext is not null` drops a layer with no features, which `ST_Extent`
   * reports as null and which has no bbox to check a camera against. The
   * `exists` clause already excludes it, and a stop lighting it is refused by
   * rule 5 as naming no published layer. Both halves are here so the invariant
   * is stated where it is enforced.
   *
   * One conjunct of `layersOnRegion` is deliberately absent: it also requires
   * the region to carry a `current_artifact_key`, which it calls belt-and-
   * braces for the atlas route's 404. Here it would answer a different
   * question. An unpublished region makes every tour on it unreadable, and
   * saying so as "no published layer" against each lit slug in turn would name
   * the wrong thing. The two only disagree in that state, and in that state
   * `layersOnRegion` returns nothing at all.
   */
  const layerRows = await db.execute(sql`
    select l.slug,
           lower(l.valid) as start, upper(l.valid) - 1 as end,
           st_xmin(e.ext) as west, st_ymin(e.ext) as south,
           st_xmax(e.ext) as east, st_ymax(e.ext) as north
    from layers l
    join lateral (
      select st_extent(f.geom) as ext from layer_features f where f.layer_id = l.id
    ) e on e.ext is not null
    where l.current_artifact_key is not null
      and l.status = 'published'
      and exists (
        select 1
        from layer_features f, regions r
        where f.layer_id = l.id
          and r.slug = ${artifact.regionSlug}
          and f.geom && r.bbox
      )
  `) as unknown as Array<{
    slug: string; start: number; end: number
    west: number; south: number; east: number; north: number
  }>

  const publishedLayers = new Map<string, LayerBounds>(
    layerRows.map((row) => [
      row.slug,
      { start: row.start, end: row.end, bbox: [row.west, row.south, row.east, row.north] },
    ]),
  )

  const problems = validateTour(artifact, {
    region: await renderRegion(region.id),
    packs: rendered,
    layers: publishedLayers,
  })
  const errors = problems.filter((problem) => problem.level === 'error')
  for (const warning of problems.filter((problem) => problem.level === 'warning')) {
    console.warn(`  warning: ${warning.message}`)
  }
  if (errors.length > 0) {
    throw new Error(
      `tour "${artifact.id}" has ${errors.length} unpublishable stop(s):\n`
      + errors.map((error) => `  - ${error.message}`).join('\n'),
    )
  }

  const hash = hashArtifact(artifact)
  const key = artifactKey('tours', artifact.id, hash)

  // Same shape as publishPack: the object is content-hashed so an orphan is
  // harmless, and only the two statements that must be atomic are in the
  // transaction.
  await storage.put(key, JSON.stringify(artifact), 'application/json')

  return db.transaction(async (tx) => {
    const [previous] = await tx.select().from(tourVersions)
      .where(eq(tourVersions.tourId, tourId))
      .orderBy(desc(tourVersions.version))
      .limit(1)
    const version = (previous?.version ?? 0) + 1

    const [row] = await tx.insert(tourVersions)
      .values({ tourId, version, artifactKey: key, artifactHash: hash })
      .returning()

    await tx.update(tours).set({ currentVersionId: row.id }).where(eq(tours.id, tourId))

    return { key, version }
  })
}
