import type { MetadataRoute } from 'next'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { SITE_URL } from '@/src/lib/site'
import { publishedAtlases, type AtlasIndexRegion } from '@/src/read/atlasIndex'
import { publishedTours } from '@/src/read/currentTour'
import { entityPages } from '@/src/read/entityPages'

/**
 * Regenerated at most every five minutes (ISR), like the pages it lists. A
 * publish shows up here on the same clock it shows up on the landing page.
 */
export const revalidate = 300

/** A region and every plate drawn inside it, flattened. */
function allRegions(regions: AtlasIndexRegion[]): AtlasIndexRegion[] {
  return regions.flatMap((region) => [region, ...allRegions(region.children)])
}

/**
 * Every page worth a crawler's visit, from the same queries that decide what
 * the site links to.
 *
 * An entity is listed only under an atlas that is published on its region,
 * because the pack layout 404s the rest. The landing page and the switcher
 * offer exactly those atlases, so nothing listed here is a dead end.
 */
async function pages(): Promise<MetadataRoute.Sitemap> {
  const [atlases, tours, entities] = await Promise.all([
    publishedAtlases(),
    publishedTours(),
    entityPages(),
  ])

  const regions = allRegions(atlases)
  const atlasPaths = new Set(
    regions.flatMap((region) => region.packs.map((pack) => `/${region.slug}/${pack.slug}`)),
  )

  const paths = [
    ...atlasPaths,
    ...tours.flatMap((region) => [
      `/${region.slug}/tours`,
      ...region.tours.map((tour) => `/${region.slug}/tours/${tour.slug}`),
    ]),
    ...entities
      .filter((page) => atlasPaths.has(`/${page.region}/${page.pack}`))
      .map((page) => `/${page.region}/${page.pack}/${page.entity}`),
  ]

  return paths.map((path) => ({ url: `${SITE_URL}${path}` }))
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const home = { url: `${SITE_URL}/` }
  try {
    return [home, ...(await pages())]
  } catch (error) {
    // At build the database may not be reachable, and a sitemap is not worth
    // failing a deploy over: ship the home page alone and let the first
    // revalidation fill the rest in. At runtime, throw, so ISR keeps serving
    // the last good copy instead of replacing it with a stub.
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw error
    console.warn('sitemap: database unreachable at build, listing the home page only')
    return [home]
  }
}
