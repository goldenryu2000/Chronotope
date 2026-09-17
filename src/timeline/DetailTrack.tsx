'use client'

import { useEffect, useRef, useState } from 'react'
import { formatYear } from '../lib/year'
import {
  type DetailWindow,
  detailTicks,
  fractionOfYear,
  shiftWindow,
  windowAround,
  yearInWindow,
} from './detailWindow'
import { describeLandmark, type Landmark } from './landmarks'

interface Props {
  year: number
  start: number
  end: number
  landmarks: readonly Landmark[]
  /** A year chosen by pointer. The caller sets it and keeps the timeline open. */
  onScrub: (year: number) => void
  onJump: (landmark: Landmark) => void
  onKeyDown: (event: React.KeyboardEvent) => void
}

/** Edge panning speed, in years a second, at the edge and at a full track-width past it. */
const PAN_MIN = 15
const PAN_MAX = 240

/** Decade labels drop "CE": on a track that close in, the era is obvious from its neighbours. */
const tickLabel = (year: number) => (year < 0 ? formatYear(year) : String(year))

/**
 * The zoomed track: 120 years, one tick each, so a reader can land on the year
 * they point at.
 *
 * The window is a ruler that holds still. Stepping, dragging and letting go
 * move the handle along it; the ruler itself moves only when the year leaves
 * it (a typed year, a landmark far away, a step off the end), and then it
 * re-centres once. Re-centring on every change, as it first did, scrolled all
 * 120 ticks under a one-year nudge and yanked the handle out from under the
 * pointer on release. While dragging, holding the pointer past either edge
 * pans the ruler, faster the further past it is.
 */
export default function DetailTrack({ year, start, end, landmarks, onScrub, onJump, onKeyDown }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<DetailWindow>(() => windowAround(year, start, end))
  // State for the render-time ruler check, a ref for the pointer handlers,
  // which run before the render that would carry the new state.
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  const viewRef = useRef(view)
  const lastX = useRef(0)
  const frame = useRef(0)

  // Adjusted during render rather than in an effect, so a year that has left
  // the ruler never paints a frame with the handle pinned to its edge. Also
  // catches a pack switch that changes the scale's ends under an open ruler.
  const outside = year < view.from || year > view.to || view.from < start || view.to > end
  if (outside && !dragging) {
    const wanted = windowAround(year, start, end)
    if (wanted.from !== view.from || wanted.to !== view.to) setView(wanted)
  }

  useEffect(() => {
    viewRef.current = view
  }, [view])

  const ticks = detailTicks(view)
  const marks = landmarks.filter((landmark) => landmark.year >= view.from && landmark.year <= view.to)

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const fractionAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    return (clientX - rect.left) / rect.width
  }

  const stopPan = () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }

  const startPan = () => {
    if (frame.current) return
    let previous = performance.now()
    let owed = 0
    const step = (now: number) => {
      const fraction = fractionAt(lastX.current)
      const current = viewRef.current
      if (fraction === null || (fraction >= 0 && fraction <= 1)) {
        frame.current = 0
        return
      }
      const overflow = fraction < 0 ? -fraction : fraction - 1
      const speed = Math.min(PAN_MAX, PAN_MIN + overflow * PAN_MAX)
      owed += (speed * (now - previous)) / 1000
      previous = now
      const years = Math.floor(owed)
      if (years > 0) {
        owed -= years
        const next = shiftWindow(current, fraction < 0 ? -years : years, start, end)
        viewRef.current = next
        setView(next)
        onScrub(yearInWindow(next, fraction))
      }
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }

  const scrub = (clientX: number) => {
    lastX.current = clientX
    const fraction = fractionAt(clientX)
    if (fraction === null) return
    onScrub(yearInWindow(viewRef.current, fraction))
    if (fraction < 0 || fraction > 1) startPan()
    else stopPan()
  }

  const release = () => {
    stopPan()
    draggingRef.current = false
    setDragging(false)
  }

  return (
    <div className="timeline__detail">
      <div className="timeline__marks">
        {marks.map((landmark) => (
          <button
            key={landmark.year}
            type="button"
            className="timeline__mark"
            data-kind={landmark.kinds[0]}
            data-label={describeLandmark(landmark)}
            aria-label={describeLandmark(landmark)}
            style={{ left: `${fractionOfYear(view, landmark.year) * 100}%` }}
            onClick={() => onJump(landmark)}
          />
        ))}
      </div>

      <div
        ref={track}
        className="timeline__detail-track"
        data-testid="detail-track"
        role="slider"
        tabIndex={0}
        aria-label="Year, one at a time"
        aria-valuemin={start}
        aria-valuemax={end}
        aria-valuenow={year}
        aria-valuetext={formatYear(year)}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId)
          draggingRef.current = true
          setDragging(true)
          scrub(event.clientX)
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) scrub(event.clientX)
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture?.(event.pointerId)
          release()
        }}
        onPointerCancel={release}
      >
        <div className="timeline__detail-rail" />
        {ticks.map((tick) => (
          <span
            key={tick.year}
            className="timeline__detail-tick"
            data-size={tick.label ? 'label' : tick.mid ? 'mid' : 'minor'}
            style={{ left: `${fractionOfYear(view, tick.year) * 100}%` }}
          >
            {tick.label && <span className="timeline__detail-label">{tickLabel(tick.year)}</span>}
          </span>
        ))}
        <div
          className="timeline__detail-handle"
          style={{ left: `${Math.min(1, Math.max(0, fractionOfYear(view, year))) * 100}%` }}
        />
      </div>
    </div>
  )
}
