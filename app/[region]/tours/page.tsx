import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { isSlug } from '@/src/data/schemas'
import { db } from '@/src/db/client'
import { regions } from '@/src/db/schema'
import { toursOnRegion } from '@/src/read/currentTour'
import './tours.css'

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

const loadRegion = cache(async (slug: string) => {
  if (!isSlug(slug)) return null
  const [row] = await db.select({ title: regions.title }).from(regions)
    .where(eq(regions.slug, slug)).limit(1)
  return row ?? null
})

export async function generateMetadata(
  props: PageProps<'/[region]/tours'>,
): Promise<Metadata> {
  const { region } = await props.params
  const row = await loadRegion(region)
  if (!row) return {}
  return {
    title: `Guided tours — ${row.title}`,
    description: `Walks through ${row.title}, one stop at a time.`,
  }
}

export default async function Page(props: PageProps<'/[region]/tours'>) {
  const { region } = await props.params
  if (!isSlug(region)) notFound()
  const [row, tours] = await Promise.all([loadRegion(region), toursOnRegion(region)])
  if (!row) notFound()

  return (
    <main className="tours-index">
      <header className="tours-index__header">
        <Link className="tours-index__back" href="/">Chronotope</Link>
        <h1 className="tours-index__title">Guided tours</h1>
        <p className="tours-index__lede">
          Each one is a route through {row.title}, read a stop at a time. The map moves with
          the narration, and you can leave at any point and keep the map where it stands.
        </p>
      </header>

      {tours.length === 0 ? (
        <p className="tours-index__empty">
          No tours have been published on this region yet.
        </p>
      ) : (
        <ul className="tours-index__list">
          {tours.map((tour) => (
            <li key={tour.slug} className="tours-index__item">
              <Link className="tours-index__link" href={`/${region}/tours/${tour.slug}`}>
                <h2 className="tours-index__name">{tour.title}</h2>
                <p className="tours-index__subtitle">{tour.subtitle}</p>
                <p className="tours-index__description">{tour.description}</p>
                <p className="tours-index__meta">
                  {tour.stops} stops · about {tour.estimatedMinutes} minutes
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
