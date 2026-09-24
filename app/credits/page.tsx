import type { Metadata } from 'next'
import Link from 'next/link'
import '../legal.css'

export const metadata: Metadata = {
  title: 'Credits',
  description: 'Where Chronotope’s borders, facts, images and code come from, and under which licences.',
}

// Read at build. Task 12 makes a Vercel build fail without the source URL.
const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL

export default function Credits() {
  return (
    <main className="legal">
      <div className="legal__inner">
        <Link className="legal__back" href="/">Chronotope</Link>
        <h1 className="legal__title">Credits</h1>

        <h2 className="legal__heading">Borders</h2>
        <p>
          Historical borders come from{' '}
          <a href="https://github.com/aourednik/historical-basemaps">historical-basemaps</a> by
          André Ourednik, under GPL-3.0. We changed them. From 1945 on, Jammu and Kashmir is drawn
          to the boundary the Survey of India requires. That boundary comes from{' '}
          <a href="https://www.naturalearthdata.com/">Natural Earth</a>, which is public domain.
        </p>

        <h2 className="legal__heading">Facts</h2>
        <p>
          Dates and places come from <a href="https://www.wikidata.org/">Wikidata</a>, which is
          CC0. Every summary is written for Chronotope and links to Wikipedia for more.
        </p>

        <h2 className="legal__heading">Images</h2>
        <p>
          Images come from <a href="https://commons.wikimedia.org/">Wikimedia Commons</a>. Each
          one is credited where it appears, with its author, its licence and a link to the
          original. We resized them for the web.
        </p>

        <h2 className="legal__heading">Routes and tours</h2>
        <p>Drawn and written for Chronotope, under GPL-3.0-or-later.</p>

        <h2 className="legal__heading">Software</h2>
        <p>
          Chronotope is free software under GPL-3.0-or-later.{' '}
          {SOURCE_URL ? (
            <a href={SOURCE_URL}>Get the source code.</a>
          ) : (
            'The source code is available on request.'
          )}
        </p>
        <p>
          Built with Next.js and React (MIT), and MapLibre GL JS and PMTiles (BSD-3-Clause). Set
          in Geist and EB Garamond (SIL Open Font License 1.1).
        </p>

        <h2 className="legal__heading">Something wrong?</h2>
        <p>
          If you hold rights to anything here and want it credited differently or removed,{' '}
          {CONTACT_EMAIL ? (
            <>write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</>
          ) : SOURCE_URL ? (
            <>open an issue at <a href={SOURCE_URL}>the source repository</a>.</>
          ) : (
            'tell us and we will fix it.'
          )}
        </p>
      </div>
    </main>
  )
}
