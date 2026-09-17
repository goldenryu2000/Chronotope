import Link from 'next/link'
import type { ReactNode } from 'react'
import { publishedAtlases } from '@/src/read/atlasIndex'
import { publishedTours } from '@/src/read/currentTour'
import { borderSpan, heroFrames } from '@/src/read/heroFrames'
import { freePortraits, tourCovers, type Portrait } from '@/src/read/landingPortraits'
import WorldPlate from '@/src/landing/WorldPlate'
import { othersCount, pinsForYear, portraitStrip, startPack } from '@/src/landing/select'
import ThemeToggle from '@/src/theme/ThemeToggle'
import '@/src/theme/register.css'
import './page.css'

/**
 * Rendered at most once every five minutes, not once per visit.
 *
 * This page used to be `force-dynamic` so a newly imported pack would appear
 * without a rebuild. In production that made every visit several PostGIS
 * queries, and anyone reloading in a loop could spend Neon's monthly compute
 * and take the site down. Five minutes of staleness keeps the original point:
 * a publish still shows up without a deploy.
 */
export const revalidate = 300

/**
 * What is coming, said plainly enough that nobody mistakes it for what is here.
 *
 * A reason to come back, so each item gets a line that makes it worth waiting
 * for. It is still a promise: every item is something that is really going to
 * be built, nothing in it is a link, and `status` says honestly how far along
 * it is. Anything that ships has to leave this list in the same change and
 * arrive somewhere clickable, or the page describes a real feature as unbuilt.
 */
type ComingIcon = 'region' | 'puzzle' | 'tour' | 'compare' | 'life' | 'atlases'

const COMING: { title: string; hook: string; status: 'in-works' | 'planned'; icon: ComingIcon }[] = [
  {
    title: 'India, up close',
    hook: 'Kingdoms, trade towns and dynasties drawn at a finer scale. More regions to follow.',
    status: 'in-works',
    icon: 'region',
  },
  { title: 'Daily puzzle', hook: 'One figure, one map. Guess where and when they lived.', status: 'planned', icon: 'puzzle' },
  { title: 'Build your own tour', hook: 'Pick the stops, write the story, share the link.', status: 'planned', icon: 'tour' },
  { title: 'Compare two years', hook: 'Split the map and see 1914 beside 1920.', status: 'planned', icon: 'compare' },
  { title: 'Follow a life', hook: "Trace one person's journey across the map, city by city.", status: 'planned', icon: 'life' },
  { title: 'New atlases', hook: 'Explorers, empires, inventions and languages.', status: 'planned', icon: 'atlases' },
]

const COMING_GROUPS = [
  { status: 'in-works', label: 'In the works' },
  { status: 'planned', label: 'Planned' },
] as const

/** Line icons for the roadmap, drawn in the current text colour. */
function ComingGlyph({ icon }: { icon: ComingIcon }) {
  const paths: Record<ComingIcon, ReactNode> = {
    region: (
      <>
        <path d="M4 6.5 9.5 4l5 2.5L20 4v13.5L14.5 20l-5-2.5L4 20z" />
        <path d="M9.5 4v13.5M14.5 6.5V20" />
      </>
    ),
    puzzle: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.4v.3M12 16.5v.01" />
      </>
    ),
    tour: (
      <>
        <circle cx="6" cy="18" r="1.8" />
        <circle cx="18" cy="6" r="1.8" />
        <path d="M7.5 17c3-1 2-5 5-6s3.5-3 4-3.5" strokeDasharray="2 2" />
      </>
    ),
    compare: (
      <>
        <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
        <path d="M12 3v18" />
      </>
    ),
    life: (
      <>
        <path d="M5 19c2-6 5-2 7-7s5-3 7-8" />
        <circle cx="5" cy="19" r="1.4" />
        <circle cx="12" cy="12" r="1.4" />
        <circle cx="19" cy="4" r="1.4" />
      </>
    ),
    atlases: (
      <>
        <path d="M12 4 3.5 8.5 12 13l8.5-4.5z" />
        <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
      </>
    ),
  }
  return (
    <svg
      className="coming__icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[icon]}
    </svg>
  )
}

/** Portraits on each pack card. */
const STRIP = 4

const NUMBER_WORDS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

/** "Five thousand years", from a span of years; null below a thousand. */
function yearsInWords(years: number): string | null {
  const thousands = Math.floor(years / 1000)
  if (thousands < 1) return null
  const count = NUMBER_WORDS[thousands] ?? thousands.toLocaleString('en')
  return `${count} thousand years`
}

/** "A, B and C". */
function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export default async function Home() {
  const [atlases, tourRegions, covers] = await Promise.all([
    publishedAtlases(),
    publishedTours(),
    tourCovers(),
  ])

  // The hero is drawn from the first region published. No slug is named here:
  // `world` is a row like any other and gets no privileges.
  const first = atlases[0]
  const [frames, span, firstPortraits] = first
    ? await Promise.all([heroFrames(first.slug), borderSpan(first.slug), freePortraits(first.slug)])
    : [[], null, [] as Portrait[]]

  // Every other region's portraits, for its own pack cards.
  const portraitsByRegion = new Map<string, Portrait[]>()
  if (first) portraitsByRegion.set(first.slug, firstPortraits)
  await Promise.all(atlases.slice(1).map(async (region) => {
    portraitsByRegion.set(region.slug, await freePortraits(region.slug))
  }))

  const start = first ? startPack(first.packs, firstPortraits) : undefined
  const otherPacks = first?.packs.filter((pack) => pack.slug !== start?.slug) ?? []
  const pins = frames.map((frame) => pinsForYear(firstPortraits, frame.year))
  const reach = span ? yearsInWords(span.last - span.first) : null
  const hasTours = tourRegions.length > 0

  return (
    <div className="home">
      <header className="masthead">
        <span className="masthead__brand">Chronotope</span>
        <nav className="masthead__nav" aria-label="Sections">
          {atlases.length > 0 && <a href="#atlases">Atlases</a>}
          {hasTours && <a href="#tours">Guided tours</a>}
          <ThemeToggle />
        </nav>
      </header>

      <main className="home__main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__text">
            <div className="hero__claim">
              <p className="hero__eyebrow">A historical atlas of the world</p>
              <h1 className="hero__title" id="hero-title">
                Pick a year. <span className="hero__title-line">Watch the world redraw.</span>
              </h1>
            </div>

            <div className="hero__offer">
              <p className="hero__lede">
                {reach ? `${reach} of borders on one map. ` : 'Borders through history on one map. '}
                Move the timeline and the philosophers, gods and creatures of that moment appear
                where people knew them.
              </p>

              {first && start && (
                <div className="hero__actions">
                  <Link className="button button--primary" href={`/${first.slug}/${start.slug}`}>
                    Open the atlas
                  </Link>
                  {hasTours && (
                    <a className="button button--secondary" href="#tours">
                      Take a guided tour
                    </a>
                  )}
                </div>
              )}

              {start && (
                <p className="hero__hint">
                  Opens on {start.title}.
                  {otherPacks.length > 0 &&
                    ` ${listed(otherPacks.map((pack) => pack.title))} ${otherPacks.length === 1 ? 'is' : 'are'} one click away.`}
                </p>
              )}
            </div>
          </div>

          <WorldPlate frames={frames} pins={pins} span={span} />
        </section>

        {atlases.length > 0 ? (
          <section className="section section--atlases" id="atlases" aria-labelledby="atlases-title">
            <div className="section__head">
              <h2 className="section__title" id="atlases-title">Choose an atlas</h2>
              <p className="section__note">
                Each one opens on the same map. Drag the timeline to change the year, then click a
                pin to read about who was there.
              </p>
            </div>

            {/* Grouped by region: a pack is a choice made inside a region, so
                the region is the map being chosen and its packs are the ways in.
                The heading is not a link; there is no `/<region>` route. */}
            {atlases.map((region) => {
              const portraits = portraitsByRegion.get(region.slug) ?? []
              return (
                <div className="region" key={region.slug}>
                  <div className="region__head">
                    <h3 className="region__title">{region.title}</h3>
                    <p className="region__subtitle">{region.subtitle}</p>
                  </div>

                  <ul className="packs">
                    {region.packs.map((pack) => {
                      const strip = portraitStrip(
                        portraits.filter((portrait) => portrait.pack === pack.slug),
                        STRIP,
                      )
                      const more = othersCount(pack.entityCount, strip.length)
                      const isStart = region === first && pack.slug === start?.slug
                      return (
                        <li key={pack.slug}>
                          <Link className="card pack" href={`/${region.slug}/${pack.slug}`}>
                            {strip.length > 0 && (
                              <span className="pack__faces">
                                {strip.map((portrait) => (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    key={portrait.slug}
                                    className="pack__face"
                                    src={portrait.src}
                                    alt={`Depiction of ${portrait.name}`}
                                    width={110}
                                    height={146}
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ))}
                              </span>
                            )}
                            <span className="pack__body">
                              <span className="pack__heading">
                                <span className="card__title">{pack.title}</span>
                                {isStart && <span className="pack__tag">Start here</span>}
                              </span>
                              <span className="card__subtitle">{pack.subtitle}</span>
                              <span className="pack__names">
                                {strip.length > 0
                                  ? `${listed([
                                    ...strip.map((portrait) => portrait.name),
                                    ...(more > 0 ? [`${more} more`] : []),
                                  ])}`
                                  : `${pack.entityCount} figures`}
                              </span>
                              <span className="pack__open">Open {pack.title}</span>
                            </span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </section>
        ) : (
          /* An empty list is a real state worth naming, not a blank space. */
          <p className="home__empty">
            No atlas has been published yet. Run <code>scripts/import-legacy.ts --all</code>,{' '}
            <code>scripts/import-boundaries.ts</code>, <code>scripts/build-tiles.ts world</code>,
            then <code>scripts/publish-all.ts</code>.
          </p>
        )}

        {hasTours && (
          <section className="section section--tours" id="tours" aria-labelledby="tours-title">
            <div className="section__head">
              <h2 className="section__title" id="tours-title">Take a guided tour</h2>
              <p className="section__note">
                A short story told stop by stop. The map moves with it, and you can leave at any
                point to explore on your own.
              </p>
            </div>

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

                <ul className="tours">
                  {region.tours.map((tour) => {
                    const cover = covers.get(tour.slug)
                    return (
                      <li key={tour.slug}>
                        <Link className="card tour" href={`/${region.slug}/tours/${tour.slug}`}>
                          {cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="tour__cover"
                              src={cover.src}
                              alt={`Depiction of ${cover.name}`}
                              width={72}
                              height={72}
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span className="tour__cover tour__cover--blank" />
                          )}
                          <span className="tour__body">
                            <span className="card__title">{tour.title}</span>
                            <span className="card__subtitle">{tour.subtitle}</span>
                            <span className="card__count">
                              {tour.stops} stops, about {tour.estimatedMinutes} minutes
                            </span>
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}

        <section className="section section--coming" aria-labelledby="coming-title">
          <div className="section__head">
            <h2 className="section__title" id="coming-title">Coming to Chronotope</h2>
            <p className="section__note">What we are building next. None of it is here yet.</p>
          </div>

          {COMING_GROUPS.map((group) => (
            <div className={`coming-group coming-group--${group.status}`} key={group.status}>
              <h3 className="coming-group__title">{group.label}</h3>
              <ul className="coming">
                {COMING.filter((item) => item.status === group.status).map((item) => (
                  <li className="coming__item" data-status={item.status} key={item.title}>
                    <ComingGlyph icon={item.icon} />
                    <span className="coming__name">{item.title}</span>
                    <span className="coming__hook">{item.hook}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </main>

      <footer className="home__footer">
        <div className="home__footer-row">
          <p>Best viewed on a desktop or laptop screen.</p>
          <p className="home__footer-links">
            <Link href="/credits">Credits</Link>
            <Link href="/privacy">Privacy</Link>
          </p>
        </div>
        <p className="home__fineprint">
          Borders from{' '}
          <a href="https://github.com/aourednik/historical-basemaps">historical-basemaps</a>{' '}
          (GPL-3.0). Jammu and Kashmir follows the boundary the Survey of India requires. Portraits
          on this page are public domain or CC0. Chronotope is GPL-3.0-or-later.
        </p>
      </footer>
    </div>
  )
}
