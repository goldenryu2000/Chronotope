import type { Metadata } from 'next'
import Link from 'next/link'
import { publishedAtlases } from '@/src/read/atlasIndex'
import './legal.css'
import './not-found.css'

export const metadata: Metadata = {
  title: 'Not found',
  // A 404 is not a page anyone should find in a search.
  robots: { index: false },
}

/**
 * The way to the widest map published, the one the landing page opens on.
 *
 * Looked up, not written down, for the landing page's reason: no region is
 * named in code. A 404 must still render when the database cannot answer, so
 * a failure here only costs the second link.
 */
async function firstAtlas(): Promise<{ href: string; title: string } | null> {
  try {
    const [region] = await publishedAtlases()
    // The fullest pack, which is what the landing page's `startPack` settles
    // on too once portraits are counted, without the extra query.
    const pack = region?.packs.toSorted((a, b) => b.entityCount - a.entityCount)[0]
    return region && pack ? { href: `/${region.slug}/${pack.slug}`, title: region.title } : null
  } catch {
    return null
  }
}

export default async function NotFound() {
  const atlas = await firstAtlas()

  return (
    <main className="legal">
      <div className="legal__inner">
        <Link className="legal__back" href="/">Chronotope</Link>
        <h1 className="legal__title">Not on this map</h1>
        <p>
          There is no page at this address. It may have moved, or the link may be mistyped.
        </p>
        <nav className="not-found__links" aria-label="Where to go instead">
          <Link className="not-found__link not-found__link--primary" href="/">Home</Link>
          {atlas && (
            <Link className="not-found__link" href={atlas.href}>
              Open the {atlas.title} atlas
            </Link>
          )}
        </nav>
      </div>
    </main>
  )
}
