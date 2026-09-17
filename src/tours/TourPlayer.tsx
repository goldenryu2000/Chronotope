'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { type Tour, TourSchema } from '../data/schemas'
import { useAtlas } from '../state/store'
import './Tours.css'

/** How long each stop holds before autoplay moves on. */
const AUTOPLAY_MS = 12_000

interface Props {
  /** The tour's published artifact, resolved on the server. */
  tourUrl: string
  slug: string
  regionSlug: string
  /** Which stop the route named, 1-based. */
  stop: number
  /** How many there are, known on the server before the artifact lands. */
  stops: number
}

/**
 * Whether the focused element answers to arrow keys itself.
 *
 * The timeline track is the one that matters: it is `role="slider"` and moves
 * the year by a step per press. With the track focused, an unguarded listener
 * would scrub the year *and* advance the stop on the same keystroke, leaving
 * the map somewhere neither control intended. Text fields are covered too,
 * before something in the chrome grows one.
 */
function ownsArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.getAttribute('role') === 'slider') return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export default function TourPlayer({ tourUrl, slug, regionSlug, stop, stops }: Props) {
  const [tour, setTour] = useState<Tour | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(stop - 1)
  const [playing, setPlaying] = useState(false)

  const applyView = useAtlas((state) => state.applyView)

  // The tour, fetched once. Its artifact is immutable and content-hashed, so
  // the browser cache makes a reload of the same stop free.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch(tourUrl)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const parsed = TourSchema.parse(await response.json())
        if (!cancelled) setTour(parsed)
      } catch (cause) {
        if (!cancelled) setError((cause as Error).message)
      }
    })()

    return () => { cancelled = true }
  }, [tourUrl])

  const current = tour?.stops[index] ?? null

  /*
   * Every stop change is a view, including the first.
   *
   * The route already parked the opening view from Postgres, so this re-parks
   * the same values on landing. That is deliberate rather than wasteful: the
   * two agree, and having one path for "go to stop n" means the first stop is
   * not a special case that can rot.
   */
  useEffect(() => {
    if (!current) return
    applyView({
      pack: current.pack,
      year: current.year,
      entityId: current.entityId,
      camera: current.camera,
      layers: current.layers,
    })
  }, [current, applyView])

  /*
   * The url follows the stop, without a navigation.
   *
   * `router.push` would re-run the server component and remount the atlas
   * island, throwing away the camera and the loaded tiles. `pushState` writes
   * the address a reload or a shared link resolves to anyway, since
   * `/<region>/tours/<tour>/<n>` is a real route. Atlas.tsx writes pack
   * switches the same way and for the same reason.
   */
  useEffect(() => {
    const path = `/${regionSlug}/tours/${slug}/${index + 1}`
    if (window.location.pathname === path) return
    window.history.pushState({ stop: index + 1 }, '', path)
  }, [regionSlug, slug, index])

  // Back and forward walk the stops.
  useEffect(() => {
    const onPopState = () => {
      const last = window.location.pathname.split('/').pop()
      const value = Number(last)
      if (Number.isInteger(value) && value > 0) setIndex(value - 1)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const total = tour?.stops.length ?? stops
  const isFirst = index === 0
  const isLast = index >= total - 1

  const goTo = useCallback(
    (next: number) => {
      setPlaying(false)
      setIndex(Math.max(0, Math.min(next, total - 1)))
    },
    [total],
  )

  /*
   * Where leaving goes: the map, on the pack the last stop was showing.
   *
   * A plain anchor rather than `next/link`. Leaving crosses a route boundary
   * and remounts the atlas either way, and this is the same address the
   * Escape key sends the reader to, so one mechanism serves both rather than
   * two that could drift.
   */
  const exitHref = `/${regionSlug}/${current?.pack ?? ''}`

  useEffect(() => {
    if (!playing || isLast) return
    const timer = setTimeout(() => {
      setIndex((value) => Math.min(value + 1, total - 1))
    }, AUTOPLAY_MS)
    return () => clearTimeout(timer)
  }, [playing, index, isLast, total])

  // Through a ref so the listener below can stay bound to a stable handler
  // while still calling the current one.
  const latest = useRef({ goTo, index, isFirst, isLast, exitHref })
  useEffect(() => {
    latest.current = { goTo, index, isFirst, isLast, exitHref }
  }, [goTo, index, isFirst, isLast, exitHref])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = latest.current
      if (event.key === 'Escape') {
        // Leaving is always safe, so it works from anywhere.
        window.location.assign(state.exitHref)
        return
      }
      if (ownsArrowKeys(event.target)) return
      if (event.key === 'ArrowRight' && !state.isLast) state.goTo(state.index + 1)
      if (event.key === 'ArrowLeft' && !state.isFirst) state.goTo(state.index - 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (error) {
    return (
      <div className="tour" role="status">
        <p className="tour__error">Could not open this tour: {error}</p>
      </div>
    )
  }

  if (!tour || !current) return null

  return (
    <section className="tour" aria-label={`Guided tour: ${tour.title}`}>
      <div className="tour__progress">
        {tour.stops.map((entry, position) => (
          <button
            // Keyed by position: a tour may visit the same entity twice, and
            // the list never reorders. The ported build keyed these on the
            // entity and produced duplicate React keys for exactly that case.
            key={position}
            type="button"
            className="tour__dot"
            data-active={position === index}
            data-passed={position < index}
            onClick={() => goTo(position)}
            aria-label={`Stop ${position + 1}: ${entry.title}`}
            aria-current={position === index ? 'step' : undefined}
          />
        ))}
      </div>

      <header className="tour__meta">
        <span className="tour__title">{tour.title}</span>
        {/* Drawn as the panel's close button is, so the two columns close the
            same way. Named in words for anyone who cannot see the glyph. */}
        <a className="tour__exit" href={exitHref} aria-label="Leave the tour" title="Leave the tour">
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </a>
        <span className="tour__where">
          <span className="tour__counter">Stop {index + 1} of {total}</span>
          {' · '}
          <span className="tour__place">{current.locationLabel}</span>
        </span>
      </header>

      <div className="tour__body">
        <h2 className="tour__stop-title">{current.title}</h2>
        <p className="tour__narration">{current.narration}</p>
      </div>

      <footer className="tour__controls">
        <button
          type="button"
          className="tour__button"
          onClick={() => setPlaying((value) => !value)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          className="tour__button"
          disabled={isFirst}
          onClick={() => goTo(index - 1)}
        >
          Back
        </button>
        {isLast ? (
          <a className="tour__button tour__button--primary" href={exitHref}>Finish</a>
        ) : (
          <button
            type="button"
            className="tour__button tour__button--primary"
            onClick={() => goTo(index + 1)}
          >
            Next stop
          </button>
        )}
      </footer>
    </section>
  )
}
