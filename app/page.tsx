import Link from 'next/link'
import { publishedAtlases } from '@/src/read/atlasIndex'
import { publishedTours } from '@/src/read/currentTour'
import { borderSpan, heroFrames } from '@/src/read/heroFrames'
import WorldPlate from '@/src/landing/WorldPlate'
import ThemeToggle from '@/src/theme/ThemeToggle'
import '@/src/theme/register.css'
import './page.css'

/**
 * Rendered at most once every five minutes, not once per visit.
 *
 * This page used to be `force-dynamic` so a newly imported pack would appear
 * without a rebuild. In production that made every visit three PostGIS
 * queries (the hero plates), and anyone reloading in a loop could spend
 * Neon's monthly compute and take the site down. Five minutes of staleness
 * keeps the original point: a publish still shows up without a deploy.
 */
export const revalidate = 300

/**
 * What is coming, said plainly enough that nobody mistakes it for what is here.
 *
 * These are the real roadmap. M3 is authoring and review, M4 is regions as a
 * product, and the rest are feature strands carried over from the build this
 * replaced. Listing them is a promise, so the section is headed as unbuilt and
 * nothing in it is clickable. A landing page that implies features it does not
 * have is the one kind of hook worth refusing.
 */
const COMING = [
  // Guided tours were here until they existed. Anything that leaves this list
  // has to arrive somewhere clickable in the same change, or the page has
  // quietly stopped mentioning a feature it now has.
  { title: 'Daily puzzle', blurb: 'One figure. Guess where and when.' },
  { title: 'Search', blurb: 'One field across every pack and year.' },
  { title: 'Your own packs', blurb: 'Write one, lay it over any region.' },
  { title: 'More regions', blurb: 'India is being drawn next.' },
  { title: 'Accounts', blurb: 'Save a place, keep a streak.' },
]

const era = (year: number) => (year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`)

export default async function Home() {
  const [atlases, tourRegions] = await Promise.all([publishedAtlases(), publishedTours()])

  // The hero is drawn from the first region published. No slug is named here:
  // `world` is a row like any other and gets no privileges (Rule 3).
  const first = atlases[0]
  const [frames, span] = first
    ? await Promise.all([heroFrames(first.slug), borderSpan(first.slug)])
    : [[], null]

  const figures = atlases.reduce(
    (total, region) => total + region.packs.reduce((n, pack) => n + pack.entityCount, 0),
    0,
  )
  const packCount = atlases.reduce((total, region) => total + region.packs.length, 0)

  return (
    <div className="home">
      {/* Same corner as the atlas keeps it, so the control does not move
          between the two screens. */}
      <div className="home__chrome">
        <ThemeToggle />
      </div>

      <header className="hero">
        <WorldPlate frames={frames} />

        {/*
          * A cartouche: the panel a printed atlas puts its title in, so the
          * lettering never has to compete with the plate it sits on. Solid
          * rather than a gradient scrim, because a scrim strong enough to make
          * the wordmark carry was strong enough to wash the map out, and this
          * costs the map nothing.
          */}
        <div className="cartouche">
          <p className="cartouche__eyebrow">A historical atlas</p>
          <h1 className="cartouche__title">Chronotope</h1>
          <p className="cartouche__lede">
            The map and the year move together. Scrub the timeline and the borders redraw, with
            pins for whoever was there at that moment.
          </p>

          {span && (
            <dl className="stats">
              <div className="stats__item">
                <dt>Figures</dt>
                <dd>{figures}</dd>
              </div>
              <div className="stats__item">
                <dt>Packs</dt>
                <dd>{packCount}</dd>
              </div>
              <div className="stats__item">
                <dt>Years drawn</dt>
                <dd>{(span.last - span.first).toLocaleString()}</dd>
              </div>
              <div className="stats__item">
                <dt>From</dt>
                <dd>{era(span.first)}</dd>
              </div>
            </dl>
          )}
        </div>
      </header>

      <main className="home__main">
        {atlases.length > 0 ? (
          <section className="section section--atlases">
            <h2 className="section__title">Open an atlas</h2>
            <p className="section__note">
              Every pack rides the same map engine. Once you are on a map you can switch packs from
              the header without losing your place or your year.
            </p>

            {/* Grouped by region rather than one card per pack. A pack is a
                choice made inside a region now, not a page of its own, so the
                region is the thing being chosen and its packs are the ways in.
                The heading is not a link: there is no `/<region>` route,
                because a region is only ever reached through one of its packs. */}
            {atlases.map((region) => (
              <div className="region" key={region.slug}>
                <div className="region__head">
                  <h3 className="region__title">{region.title}</h3>
                  <p className="region__subtitle">{region.subtitle}</p>
                </div>

                <ul className="region__packs">
                  {region.packs.map((pack) => (
                    <li key={pack.slug}>
                      <Link className="card" href={`/${region.slug}/${pack.slug}`}>
                        <span className="card__title">{pack.title}</span>
                        <span className="card__subtitle">{pack.subtitle}</span>
                        <span className="card__count">{pack.entityCount} figures</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ) : (
          /* The same reasoning as the atlas route's 404: an empty list is a
             real state worth naming, not a blank space to render around. */
          <p className="home__empty">
            No atlas has been published yet. Run <code>scripts/import-legacy.ts --all</code>,{' '}
            <code>scripts/import-boundaries.ts</code>, <code>scripts/build-tiles.ts world</code>,
            then <code>scripts/publish-all.ts</code>.
          </p>
        )}

        {tourRegions.length > 0 && (
          <section className="section section--tours">
            <h2 className="section__title">Take a guided tour</h2>
            <p className="section__note">
              A route someone has already walked, read a stop at a time. The map moves with the
              narration, and a tour can cross packs where the story does. Leave whenever you like
              and the map stays where the tour left it.
            </p>

            {/* Grouped by region, the same shape the atlases above use, because
                a tour is a route through one particular map and the reader is
                choosing which. */}
            {tourRegions.map((region) => (
              <div className="region" key={region.slug}>
                <div className="region__head">
                  <h3 className="region__title">{region.title}</h3>
                  <p className="region__subtitle">
                    <Link className="region__more" href={`/${region.slug}/tours`}>
                      All {region.tours.length} tours
                    </Link>
                  </p>
                </div>

                <ul className="region__packs">
                  {region.tours.map((tour) => (
                    <li key={tour.slug}>
                      <Link className="card" href={`/${region.slug}/tours/${tour.slug}`}>
                        <span className="card__title">{tour.title}</span>
                        <span className="card__subtitle">{tour.subtitle}</span>
                        <span className="card__count">
                          {tour.stops} stops · about {tour.estimatedMinutes} minutes
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <section className="section">
          <h2 className="section__title">Not built yet</h2>
          <p className="section__note">Where this is going. Nothing below is a link.</p>

          <ul className="coming">
            {COMING.map((item) => (
              <li className="coming__item" key={item.title}>
                <span className="coming__title">{item.title}</span>
                <span className="coming__blurb">{item.blurb}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="home__footer">
        <p>
          Borders from{' '}
          <a href="https://github.com/aourednik/historical-basemaps">historical-basemaps</a>{' '}
          (GPL-3.0). Jammu and Kashmir is drawn to the boundary the Survey of India requires, a
          deliberate divergence recorded rather than hidden. Chronotope is GPL-3.0-or-later.
        </p>
        <p>
          <Link href="/credits">Credits</Link> · <Link href="/privacy">Privacy</Link>
        </p>
      </footer>
    </div>
  )
}
