'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActiveEntity } from '../data/entitySpan'
import { formatYear } from '../lib/year'
import { useAtlas } from '../state/store'
import { layerSlotToken } from '../theme/layerSlots'
import DetailTrack from './DetailTrack'
import { buildLandmarks, describeLandmark, type Landmark, nextLandmark, previousLandmark } from './landmarks'
import type { PlacedEra, TimelineScale } from './scale'
import { useExpansion } from './useExpansion'
import YearField from './YearField'
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
  /** The years this region's borders redraw, from the region artifact. */
  borderChanges?: readonly number[]
}

export default function Timeline({ scale, entities, spans, borderChanges = [] }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const year = useAtlas((state) => state.year)
  const setYear = useAtlas((state) => state.setYear)
  const [playing, setPlaying] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const { expanded, pinned, touch, togglePinned, handlers } = useExpansion()

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

  /** The moments worth jumping between: border changes, eras, arrivals and departures, lit layers. */
  const landmarks = useMemo(
    () =>
      buildLandmarks({
        start: scale.start,
        end: scale.end,
        borderChanges,
        eras: scale.eras,
        entities,
        spans,
      }),
    [scale, borderChanges, entities, spans],
  )

  /**
   * Only border changes are marked on the overview. Arrivals and departures
   * would be hundreds of ticks across the whole of history; the detail track
   * shows every kind at a scale where they can be told apart.
   */
  const borderMarks = useMemo(
    () => landmarks.filter((landmark) => landmark.kinds.includes('border')),
    [landmarks],
  )

  const goTo = useCallback(
    (target: number) => {
      setPlaying(false)
      setYear(clampYear(target, scale))
      touch()
    },
    [scale, setYear, touch],
  )

  const jump = useCallback(
    (landmark: Landmark | null) => {
      if (!landmark) return
      goTo(landmark.year)
      setAnnouncement(describeLandmark(landmark))
    },
    [goTo],
  )

  const yearAtClientX = useCallback(
    (clientX: number) => {
      const rect = track.current?.getBoundingClientRect()
      // A track with no width (not laid out yet) has no year under the pointer.
      if (!rect || rect.width === 0) return year
      return scale.toYear((clientX - rect.left) / rect.width)
    },
    [scale, year],
  )

  const scrubTo = useCallback(
    (clientX: number) => goTo(yearAtClientX(clientX)),
    [goTo, yearAtClientX],
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

  /** Shared by both tracks, so the keys behave the same wherever focus is. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Home') {
      goTo(scale.start)
    } else if (event.key === 'End') {
      goTo(scale.end)
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      goTo(addYears(year, event.key === 'PageUp' ? 100 : -100))
    } else if (event.key === ']') {
      jump(nextLandmark(landmarks, year))
    } else if (event.key === '[') {
      jump(previousLandmark(landmarks, year))
    } else {
      const step = KEY_STEPS[event.key]
      if (step === undefined) return
      goTo(addYears(year, step * (event.shiftKey ? 10 : 1)))
    }

    event.preventDefault()
  }

  const previous = previousLandmark(landmarks, year)
  const next = nextLandmark(landmarks, year)

  return (
    <div className="timeline" data-expanded={expanded} {...handlers}>
      <button
        type="button"
        className="timeline__pin"
        onClick={togglePinned}
        aria-pressed={pinned}
        aria-label="Keep the precise timeline open"
        title={pinned ? 'Let the timeline fold away' : 'Keep the precise timeline open'}
      >
        {pinned ? <CollapseIcon /> : <ExpandIcon />}
      </button>

      <div className="timeline__readout">
        <div className="timeline__nav">
          <button
            type="button"
            className="timeline__step timeline__step--jump"
            onClick={() => jump(previous)}
            disabled={!previous}
            aria-label={previous ? `Previous landmark, ${describeLandmark(previous)}` : 'No earlier landmark'}
            title={previous ? describeLandmark(previous) : undefined}
          >
            <JumpIcon direction="back" />
          </button>
          <button
            type="button"
            className="timeline__step"
            onClick={() => goTo(addYears(year, -1))}
            aria-label="Back one year"
          >
            <StepIcon direction="back" />
          </button>

          <YearField year={year} onCommit={goTo} onEdit={touch} />

          <button
            type="button"
            className="timeline__step"
            onClick={() => goTo(addYears(year, 1))}
            aria-label="Forward one year"
          >
            <StepIcon direction="forward" />
          </button>
          <button
            type="button"
            className="timeline__step timeline__step--jump"
            onClick={() => jump(next)}
            disabled={!next}
            aria-label={next ? `Next landmark, ${describeLandmark(next)}` : 'No later landmark'}
            title={next ? describeLandmark(next) : undefined}
          >
            <JumpIcon direction="forward" />
          </button>
        </div>
        <p className="timeline__era">{era.label}</p>
        <p className="timeline__blurb">{era.blurb}</p>
        <p className="timeline__announcement" data-testid="timeline-announcement" aria-live="polite">
          {announcement}
        </p>
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
          {expanded && (
            <DetailTrack
              year={year}
              start={scale.start}
              end={scale.end}
              landmarks={landmarks}
              onScrub={goTo}
              onJump={jump}
              onKeyDown={onKeyDown}
            />
          )}

          <div className="timeline__bands">
            {scale.eras.map((band) => (
              <button
                key={band.id}
                type="button"
                className="timeline__band"
                data-current={band.id === era.id}
                style={{ width: `${band.span * 100}%` }}
                title={band.blurb}
                onClick={() => goTo(midpoint(band))}
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
              event.currentTarget.setPointerCapture?.(event.pointerId)
              scrubTo(event.clientX)
            }}
            onPointerMove={(event) => {
              if (dragging.current) scrubTo(event.clientX)
            }}
            onPointerUp={(event) => {
              dragging.current = false
              event.currentTarget.releasePointerCapture?.(event.pointerId)
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
            {borderMarks.map((landmark) => (
              <div
                key={landmark.year}
                className="timeline__landmark"
                style={{ left: `${scale.toPosition(landmark.year) * 100}%` }}
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

/**
 * `year + n`, skipping the year 0 this atlas does not have.
 *
 * The old keyboard handler added years straight, so one press of → from 1 BCE
 * landed on a year that does not exist.
 */
function addYears(year: number, n: number): number {
  const result = year + n
  if (year < 0 && result >= 0) return result + 1
  if (year > 0 && result <= 0) return result - 1
  return result
}

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

function StepIcon({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={direction === 'back' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function JumpIcon({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d={direction === 'back' ? 'M9 3 4 8l5 5M13 3 8 8l5 5' : 'M3 3l5 5-5 5M7 3l5 5-5 5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M13.5 6.5h-4v-4M9.5 6.5 14 2M2.5 9.5h4v4M6.5 9.5 2 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
