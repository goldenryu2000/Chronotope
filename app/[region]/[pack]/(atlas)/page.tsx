import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { Atlas } from '@/src/atlas/Atlas'
import { isSlug } from '@/src/data/schemas'
import { db } from '@/src/db/client'
import { packs, regions } from '@/src/db/schema'
import { currentArtifactUrl } from '@/src/read/currentArtifact'
import { layersOnRegion } from '@/src/read/regionLayers'
import { packsOnRegion } from '@/src/read/regionPacks'

/**
 * Cached per URL for five minutes (ISR). A publish moves the version pointer,
 * and the old artifact stays in the bucket, so a page that is a few minutes
 * stale still loads.
 */
export const revalidate = 300

/**
 * Nothing is rendered at build. The empty list is what makes Next cache these
 * pages on first visit: with `revalidate` alone, a route with dynamic segments
 * stays dynamic. See generate-static-params.md, "All paths at runtime".
 */
export async function generateStaticParams() {
  return []
}

/**
 * The region's and the pack's own words for themselves, for the tab title.
 *
 * From Postgres rather than from the published artifact, deliberately:
 *
 * - This route's server half already queries Postgres to resolve the current
 *   version pointer (`currentArtifactUrl`), so reading two more columns adds
 *   no new dependency. It is the *browser* that never talks to the database,
 *   and that is unchanged — the artifact is still the only thing it fetches.
 * - The artifact URL is root-relative (`/artifacts/…`). Reading it on the
 *   server would mean an HTTP round trip back to ourselves with an origin
 *   reconstructed from request headers, plus a Zod parse of a whole pack, to
 *   recover two strings that are one `select` away.
 *
 * The cost of the choice: if someone edits a title in the database without
 * republishing, the tab would describe content the page is not yet showing.
 * There is no authoring UI until M3, so nothing can currently do that.
 *
 * `cache` so this and the render below share one round trip per request.
 */
const loadTitles = cache(async (region: string, pack: string) => {
  if (!isSlug(region) || !isSlug(pack)) return null
  const [regionRows, packRows] = await Promise.all([
    db.select({ title: regions.title }).from(regions).where(eq(regions.slug, region)).limit(1),
    db
      .select({ title: packs.title, subtitle: packs.subtitle })
      .from(packs)
      .where(eq(packs.slug, pack))
      .limit(1),
  ])
  if (!regionRows[0] || !packRows[0]) return null
  return { region: regionRows[0], pack: packRows[0] }
})

export async function generateMetadata(
  props: PageProps<'/[region]/[pack]'>,
): Promise<Metadata> {
  const { region, pack } = await props.params
  const titles = await loadTitles(region, pack)
  // The page 404s in this case; the root layout's default title covers it.
  if (!titles) return {}

  return {
    // The layout supplies the "— Chronotope" suffix via `title.template`.
    title: `${titles.pack.title} — ${titles.region.title}`,
    description: titles.pack.subtitle,
  }
}

export default async function Page(props: PageProps<'/[region]/[pack]'>) {
  const { region, pack } = await props.params
  if (!isSlug(region) || !isSlug(pack)) notFound()

  // `region` is just a slug here — 'world' gets no special treatment. A
  // region is a row in the regions table like any other; only its content
  // (bbox, eras) makes it the whole world.
  // The switcher's list is resolved here, with the urls, for the same reason
  // they are: the browser never asks the database anything. It is one query
  // against rows this request has already warmed, and it is what lets the pack
  // be a choice made on the map rather than a page of its own.
  const [regionUrl, packUrl, siblings, regionLayers] = await Promise.all([
    currentArtifactUrl('regions', region),
    currentArtifactUrl('packs', pack),
    packsOnRegion(region),
    layersOnRegion(region),
  ])

  // A version pointer can outlive the object it points at during a bad
  // deploy. Rendering a blank map in that case would hide the failure;
  // 404ing surfaces it.
  if (!regionUrl || !packUrl) notFound()

  return (
    <Atlas
      packUrl={packUrl}
      regionUrl={regionUrl}
      packs={siblings}
      activePack={pack}
      regionSlug={region}
      layers={regionLayers}
    />
  )
}
