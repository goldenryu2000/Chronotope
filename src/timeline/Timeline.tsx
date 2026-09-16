'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActiveEntity } from '../data/entitySpan'
import { formatYear } from '../lib/year'
import { useAtlas } from '../state/store'
import { layerSlotToken } from '../theme/layerSlots'
import type { PlacedEra, TimelineScale } from './scale'
import './Timeline.css'

/** How long a full sweep of the track takes when playing. */
const AUTOPLAY_DURATION_MS = 45_000

const KEY_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowUp: 1,
}

interface Props {
  scale: TimelineScale
  entities: readonly ActiveEntity[]
  /**
   * The years each lit layer covers.
   *
   * A layer is a temporal object, not only a spatial one: the Silk Road is a
   * claim about 130 BCE to 1450, and a reader who lights it at 1900 sees an
   * empty map with no idea which way to scrub. The build this is ported from
   * promised this in its menu copy and never built it.
   */
  spans: readonly { slug: string; name: string; from: number; to: number; paletteSlot: number }[]
}

export default function Timeline({ scale, entities, spans }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const year = useAtlas((state) => state.year)
  const setYear = useAtlas((state) => state.setYear)
  const [playing, setPlaying] = useState(false)

  const position = scale.toPosition(year)
  const era = scale.eraAt(year)

  /**
   * One faint bar per entity, spanning the years they are on the map.
   *
   * Drawn per entity rather than as a bucketed histogram so that overlaps
   * darken on their own — a crowded century reads as a denser mark with no
   * counting involved. With a sparse pack this is the difference between "why
   * is the map empty?" and "ah, the material is over there."
   */
  const density = useMemo(
    () =>
      entities.map((entity) => {
        const from = scale.toPosition(entity.from)
        const to = scale.toPosition(entity.to)
        return {
          id: entity.id,
          left: from * 100,
          // A floor so a short life stays visible rather than vanishing.
          width: Math.max((to - from) * 100, 0.35),
        }
      }),
    [entities, scale],
  )

  /**
   * One bar per lit layer, across the years it draws on this scale.
   *
   * A layer's years and the pack's periodization are independent, so the two
   * need not meet at all: the Atlantic passage runs to 1850 on a scale that
   * may stop at 1500. One that misses entirely is dropped rather than pinned
   * to the nearest end, because a band hard against the edge reads as "it
   * draws here" for a layer that draws nowhere on this track, which is the
   * misreading the row exists to prevent. `scale.toPosition` clamps to the
   * ends itself, so a span that merely overruns needs no clamping here.
   */
  const bands = useMemo(
    () =>
      spans
        .filter((span) => span.to >= scale.start && span.from <= scale.end)
        .map((span) => {
          const from = scale.toPosition(span.from)
          const to = scale.toPosition(span.to)
          // A floor so a one-year layer stays visible rather than vanishing.
          const width = Math.max((to - from) * 100, 0.5)
          return {
            slug: span.slug,
            name: span.name,
            slot: span.paletteSlot,
            from: span.from,
            to: span.to,
            // Held back off the right edge by its own width. Without this a
            // layer that begins in the scale's last year sits at 100% and the
            // floor pushes it to 100.5%, painting into the card's padding
            // rather than onto the track. The left edge never needed it: a
            // band there starts at 0 and grows inward.
            left: Math.min(from * 100, 100 - width),
            width,
          }
        }),
    [spans, scale],
  )

  const yearAtClientX = useCallback(
    (clientX: number) => {
      const rect = track.current?.getBoundingClientRect()
      if (!rect) return year
      return scale.toYear((clientX - rect.left) / rect.width)
    },
    [scale, year],
  )

  const scrubTo = useCallback(
    (clientX: number) => {
      setPlaying(false)
      setYear(yearAtClientX(clientX))
    },
    [setYear, yearAtClientX],
  )

  /**
   * Autoplay advances by track position, not by years.
   *
   * Stepping a fixed number of years per second would crawl through the Axial
   * Age and then blur through the twentieth century — the exact distortion the
   * weighted scale exists to remove. Moving at a constant speed along the track
   * keeps the pace even to the eye.
   */
  useEffect(() => {
    if (!playing) return

    let frame = 0
    let previous = performance.now()

    // Position is authoritative while playing. Deriving it back from the year
    // each frame would quantise to whole years — and in a wide era a single
    // year is a larger step than one frame's worth of movement, so the pace
    // would drift noticeably.
    let position = scale.toPosition(useAtlas.getState().year)

    const step = (now: number) => {
      position += (now - previous) / AUTOPLAY_DURATION_MS
      previous = now

      if (position >= 1) {
        setYear(scale.end)
        setPlaying(false)
        return
      }

      setYear(scale.toYear(position))
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, scale, setYear])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Home') {
      setYear(scale.start)
    } else if (event.key === 'End') {
      setYear(scale.end)
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      const direction = event.key === 'PageUp' ? 1 : -1
      setYear(clampYear(year + direction * 100, scale))
    } else {
      const step = KEY_STEPS[event.key]
      if (step === undefined) return
      setYear(clampYear(year + step * (event.shiftKey ? 10 : 1), scale))
    }

    event.preventDefault()
    setPlaying(false)
  }

  return (
    <div className="timeline">
      <div className="timeline__readout">
        <output className="timeline__year" data-testid="year-readout">
          {formatYear(year)}
        </output>
        <p className="timeline__era">{era.label}</p>
        <p className="timeline__blurb">{era.blurb}</p>
      </div>

      <div className="timeline__controls">
        <button
          className="timeline__play"
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? 'Pause' : 'Play through history'}
          aria-pressed={playing}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>

        <div className="timeline__stack">
          <div className="timeline__bands">
            {scale.eras.map((band) => (
              <button
                key={band.id}
                type="button"
                className="timeline__band"
                data-current={band.id === era.id}
                style={{ width: `${band.span * 100}%` }}
                title={band.blurb}
                onClick={() => {
                  setPlaying(false)
                  setYear(midpoint(band))
                }}
              >
                <span className="timeline__band-label">{band.label}</span>
              </button>
            ))}
          </div>

          {bands.length > 0 && (
            <div className="timeline__layer-spans" data-testid="layer-spans" aria-hidden="true">
              {bands.map((band) => (
                /*
                 * A lane each, rather than every band at `top: 0`.
                 *
                 * Eight of the nine layers this ships with overlap somebody
                 * else somewhere, so sharing one lane is the normal case, not
                 * the corner: three lit layers over the Mediterranean became
                 * one bar in a blended colour matching no swatch in the menu,
                 * and the longest span underneath was invisible for its whole
                 * length. A row promising one bar per layer has to draw one
                 * bar per layer.
                 */
                <div key={band.slug} className="timeline__layer-lane">
                  <span
                    className="timeline__layer-span"
                    title={`${band.name}: ${formatYear(band.from)} to ${formatYear(band.to)}`}
                    style={{
                      left: `${band.left}%`,
                      width: `${band.width}%`,
                      background: `var(${layerSlotToken(band.slot)})`,
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div
            className="timeline__track"
            data-testid="timeline-track"
            ref={track}
            role="slider"
            tabIndex={0}
            aria-label="Year"
            aria-valuemin={scale.start}
            aria-valuemax={scale.end}
            aria-valuenow={year}
            aria-valuetext={`${formatYear(year)}, ${era.label}`}
            onKeyDown={onKeyDown}
            onPointerDown={(event) => {
              dragging.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              scrubTo(event.clientX)
            }}
            onPointerMove={(event) => {
              if (dragging.current) scrubTo(event.clientX)
            }}
            onPointerUp={(event) => {
              dragging.current = false
              event.currentTarget.releasePointerCapture(event.pointerId)
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          >
            <div className="timeline__density" aria-hidden="true">
              {density.map((mark) => (
                <span
                  key={mark.id}
                  className="timeline__density-mark"
                  style={{ left: `${mark.left}%`, width: `${mark.width}%` }}
                />
              ))}
            </div>

            <div className="timeline__rail" />
            {scale.eras.slice(1).map((band) => (
              <div
                key={band.id}
                className="timeline__tick"
                style={{ left: `${band.offset * 100}%` }}
              />
            ))}
            <div className="timeline__fill" style={{ width: `${position * 100}%` }} />
            <div className="timeline__handle" style={{ left: `${position * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  )
}

const midpoint = (era: PlacedEra) => Math.round((era.start + era.end) / 2)

const clampYear = (year: number, scale: TimelineScale) =>
  Math.min(scale.end, Math.max(scale.start, year))

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" />
    </svg>
  )
}
