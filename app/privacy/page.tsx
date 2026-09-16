import type { Metadata } from 'next'
import Link from 'next/link'
import '../legal.css'

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What Chronotope collects about you, which is almost nothing.',
}

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL

export default function Privacy() {
  return (
    <main className="legal">
      <div className="legal__inner">
        <Link className="legal__back" href="/">Chronotope</Link>
        <h1 className="legal__title">Privacy</h1>

        <p>Chronotope has no accounts, no cookies, no ads and no analytics.</p>
        <p>
          Your choice of theme is saved in your own browser. It is never sent to us.
        </p>
        <p>
          Pages are served by Vercel and map data by Cloudflare. Like any web host, they log
          requests, including your IP address, to deliver the site and protect it from abuse. We
          do not use those logs to follow you around.
        </p>
        <p>
          Links to Wikipedia and Wikimedia Commons take you to sites with their own privacy
          policies.
        </p>
        {CONTACT_EMAIL && (
          <p>
            Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        )}
      </div>
    </main>
  )
}
