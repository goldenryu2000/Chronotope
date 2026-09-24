'use client'

/**
 * A script that runs while the HTML is parsed, and never again.
 *
 * React warns in development whenever a render produces a <script>, because
 * one inserted by the client does not execute. That is what we want here: the
 * server's copy has already run by the time React hydrates. So the server
 * renders a real script and the client renders an inert `text/plain` one, and
 * `suppressHydrationWarning` accepts the difference. This is the pattern in
 * Next's "Preventing flash before hydration" guide.
 *
 * A client component so the `window` check is made in both places. As a server
 * component it would only ever see the server, and the client would be handed
 * a live script to render and warn about.
 */
export default function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
