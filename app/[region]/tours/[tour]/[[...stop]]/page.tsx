import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { Atlas } from '@/src/atlas/Atlas'
import { isSlug } from '@/src/data/schemas'
import { db } from '@/src/db/client'
import { tours } from '@/src/db/schema'
import { openGraph } from '@/src/lib/site'
import { currentArtifactUrl } from '@/src/read/currentArtifact'
import { currentTourUrl, tourOpening } from '@/src/read/currentTour'
import { plateTree } from '@/src/read/regionKin'
import { layersOnRegion } from '@/src/read/regionLayers'
import { packsOnRegion } from '@/src/read/regionPacks'
import TourPlayer from '@/src/tours/TourPlayer'

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
 * Which stop the URL names, 1-based, defaulting to the first.
 *
 * An optional catch-all so `/gods-grew-quiet` and `/gods-grew-quiet/4` are one
 * file. Anything that is not a positive integer is not a stop, and 404s rather
 * than silently opening stop 1: a mistyped link that quietly works is a link
 * nobody notices is wrong.
 */
function stopNumber(segments: string[] | undefined): number | null {
  if (!segments || segments.length === 0) return 1
  if (segments.length > 1) return null
  const value = Number(segments[0])
  return Number.isInteger(value) && value > 0 ? value : null
}

const loadTour = cache(async (slug: string) => {
  if (!isSlug(slug)) return null
  const [row] = await db
    .select({ title: tours.title, subtitle: tours.subtitle, description: tours.description })
    .from(tours).where(eq(tours.slug, slug)).limit(1)
  return row ?? null
})

export async function generateMetadata(
  props: PageProps<'/[region]/tours/[tour]/[[...stop]]'>,
): Promise<Metadata> {
  const { region, tour } = await props.params
  const row = await loadTour(tour)
  if (!row) return {}
  // Every stop is one tour, so they all name its first page as the original.
  const url = `/${region}/tours/${tour}`
  return {
    title: row.title,
    description: row.description,
    alternates: { canonical: url },
    openGraph: openGraph({ title: row.title, description: row.description, url }),
  }
}

export default async function Page(
  props: PageProps<'/[region]/tours/[tour]/[[...stop]]'>,
) {
  const { region, tour, stop } = await props.params
  if (!isSlug(region) || !isSlug(tour)) notFound()
  const ordinal = stopNumber(stop)
  if (ordinal === null) notFound()

  const opening = await tourOpening(tour, ordinal)
  // A stop past the end, or a tour with no stops at all.
  if (!opening) notFound()

  const [regionUrl, tourUrl, siblings, regionLayers, plates] = await Promise.all([
    currentArtifactUrl('regions', region),
    currentTourUrl(tour),
    packsOnRegion(region),
    layersOnRegion(region),
    plateTree(),
  ])
  if (!regionUrl || !tourUrl) notFound()

  // The stop's own pack, resolved from the switcher's list so a tour cannot
  // open a pack that is not published on this region.
  const packUrl = siblings.find((entry) => entry.slug === opening.pack)?.artifactUrl
  if (!packUrl) notFound()

  return (
    <Atlas
      packUrl={packUrl}
      regionUrl={regionUrl}
      packs={siblings}
      activePack={opening.pack}
      regionSlug={region}
      layers={regionLayers}
      // The tree, so the title still names the map and still leads out of it.
      // The invitation to go deeper stands itself down during a tour: a way
      // out is never an interruption and an offer to leave mid-narration is.
      // `Atlas` does that by reading the tour's own presence, not this prop.
      plates={plates}
      // The address is the stop, not the pack. See Atlas's prop comment.
      writesPackUrl={false}
      initialView={{
        pack: opening.pack,
        year: opening.year,
        entityId: opening.entityId,
        camera: opening.camera,
        layers: opening.layers,
      }}
    >
      <TourPlayer
        tourUrl={tourUrl}
        slug={tour}
        regionSlug={region}
        stop={ordinal}
        stops={opening.stops}
      />
    </Atlas>
  )
}
