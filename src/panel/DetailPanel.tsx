'use client'

import { useEffect, useMemo, useRef } from 'react'
import { activeAt, type ActiveEntity } from '../data/entitySpan'
import type { Tradition } from '../data/schemas'
import { distanceKm } from '../lib/geo'
import { formatYear } from '../lib/year'
import ImageCredit from './ImageCredit'
import './DetailPanel.css'

/*
 * Depictions live under public/, keyed by pack. The ported build built this
 * from `import.meta.env.BASE_URL`, which Vite substituted; under Next the app
 * is served from the root, so the base is simply "/". Milestone 2's storage
 * work is where these should start travelling with the published artifact
 * rather than sitting in the public directory by convention.
 */
const IMAGES_URL = '/images/'

/** How many contemporaries to surface. Enough to make the point, not a list. */
const CONTEMPORARY_COUNT = 3

/** Below this, two entities are near enough that "elsewhere" would be a lie. */
const ELSEWHERE_KM = 1500

interface Props {
  entity: ActiveEntity
  /** Which pack's image directory to read from. */
  pack: string
  entities: readonly ActiveEntity[]
  traditions: readonly Tradition[]
  /** What the span means in this pack: "lived", "attested". */
  spanLabel: string
  year: number
  onSelect: (id: string) => void
  onFocusPair: (pair: [[number, number], [number, number]]) => void
  onClose: () => void
}

export default function DetailPanel({
  entity,
  pack,
  entities,
  traditions,
  spanLabel,
  year,
  onSelect,
  onFocusPair,
  onClose,
}: Props) {
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Move focus into the panel so keyboard users are not left on the map.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true })
  }, [entity.id])

  /**
   * The whole argument of this atlas in one list: who else was thinking, far
   * away, at this exact moment. Sorted by distance descending, because
   * "Mencius, 7,000km away" carries the point and "someone in the next city"
   * does not.
   */
  const elsewhere = useMemo(() => {
    return activeAt(entities, year)
      .filter((other) => other.id !== entity.id)
      .map((other) => ({ other, km: distanceKm(entity, other) }))
      .filter(({ km }) => km >= ELSEWHERE_KM)
      .sort((a, b) => b.km - a.km)
      .slice(0, CONTEMPORARY_COUNT)
  }, [entities, entity, year])

  const labelFor = (id: string) => traditions.find((t) => t.id === id)?.label ?? id

  return (
    <aside
      className="panel"
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={entity.name}
    >
      <button className="panel__close" type="button" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div className="panel__scroll">
        {entity.image && (
          <figure className="panel__figure">
            {/* A plain <img>, not next/image: these are static files served
                from public/ at a size the panel fixes in CSS, so the loader
                would optimise nothing and only add a request. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="panel__image"
              src={`${IMAGES_URL}${pack}/${entity.image.file}`}
              /* Deliberately "depiction of", not a name alone. Most of these are
                 later artefacts — a Roman copy, a manuscript drawing — and the
                 alt text should not claim to be a likeness either. */
              alt={`Depiction of ${entity.name}`}
              loading="lazy"
              width={320}
            />
            <ImageCredit block="panel" image={entity.image} />
          </figure>
        )}

        <h2 className="panel__name">{entity.name}</h2>

        <p className="panel__dates">
          {entity.fuzzy && <span className="panel__circa">c.</span>}
          {formatYear(entity.start)} – {formatYear(entity.end)}
          {/* "lived" for people, "attested" for gods and monsters. A creature
              has no birthday and the panel should not imply one. */}
          <span className="panel__span-label">{spanLabel}</span>
        </p>

        <p className="panel__place">{entity.place}</p>

        <ul className="panel__traditions">
          {entity.traditions.map((id) => (
            <li key={id}>{labelFor(id)}</li>
          ))}
        </ul>

        <p className="panel__blurb">{entity.blurb}</p>

        {entity.ideas.length > 0 && (
          <>
            <h3 className="panel__heading">Known for</h3>
            <ul className="panel__ideas">
              {entity.ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          </>
        )}

        {elsewhere.length > 0 && (
          <>
            <h3 className="panel__heading">Meanwhile, elsewhere</h3>
            <ul className="panel__elsewhere">
              {elsewhere.map(({ other, km }) => (
                <li key={other.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onFocusPair([
                        [entity.lng, entity.lat],
                        [other.lng, other.lat],
                      ])
                      onSelect(other.id)
                    }}
                  >
                    <span className="panel__elsewhere-name">{other.name}</span>
                    <span className="panel__elsewhere-place">
                      {other.place} · {(Math.round(km / 100) * 100).toLocaleString('en')} km away
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <a
          className="panel__link"
          href={entity.wikipedia}
          target="_blank"
          rel="noreferrer noopener"
        >
          Read on Wikipedia
        </a>

        {entity.fuzzy && (
          <p className="panel__note">
            Dates are estimates. A great deal of what this atlas covers is only datable to
            within a century.
          </p>
        )}
      </div>
    </aside>
  )
}
