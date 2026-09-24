import type { Metadata } from 'next'

/**
 * Where the site lives, for anything that has to be an absolute URL: share
 * previews, canonical links, the sitemap.
 *
 * The www host, because that is the one that answers. The apex redirects to
 * it, and a canonical or og:url that redirects is one a crawler has to chase.
 * A preview deploy can set NEXT_PUBLIC_SITE_URL to its own origin.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.chronotope.in').replace(/\/+$/, '')

export const SITE_NAME = 'Chronotope'

/** app/opengraph-image.tsx, as a route names it when it has no picture of its own. */
export const SITE_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Chronotope. Pick a year. Watch the world redraw.',
}

/**
 * A route's `openGraph`, with the site-wide fields restated.
 *
 * Metadata merges shallowly: a page that sets `openGraph` at all replaces the
 * layout's whole object, so a page that set only a title would lose the site
 * name and type. Every route goes through here so none of them forgets.
 *
 * The same goes for the picture. The root `opengraph-image` reaches a route
 * only while nothing below the layout sets `openGraph`, so a route without a
 * picture of its own names the site's explicitly.
 */
export function openGraph(fields: {
  title: string
  description: string
  url?: string
  images?: NonNullable<Metadata['openGraph']>['images']
}): Metadata['openGraph'] {
  return {
    siteName: SITE_NAME,
    type: 'website',
    locale: 'en',
    ...fields,
    images: fields.images ?? SITE_IMAGE,
  }
}
