import type { CSSProperties } from 'react'
import { formatYear } from '../lib/year'
import { PLATE_VIEWBOX, type HeroFrame } from '../read/heroFrames'
import type { Portrait } from '../read/landingPortraits'
import { platePosition } from './select'
import './WorldPlate.css'

interface Props {
  frames: readonly HeroFrame[]
  /** The figures to pin on each frame, in the same order as `frames`. */
  pins: readonly (readonly Portrait[])[]
  /** The years the region has borders for; the timeline under the plate spans it. */
  span: { first: number; last: number } | null
}

/** Seconds each year holds the plate. */
const HOLD = 6

/**
 * The claim, shown instead of described: the map is redrawn to match a year.
 *
 * The same `boundaries` table the atlas draws, at three years, cross-fading,
 * with a timeline whose marker slides to each year and portraits that appear
 * where those figures were. It reads like a short screen recording of the
 * atlas, and it is the atlas's own data.
 *
 * No JavaScript and no hydration: paths, images and CSS animations offset by
 * a share of one cycle each. Decorative, so hidden from assistive technology
 * and click-through; the real links are the buttons beside it.
 */
export default function WorldPlate({ frames, pins, span }: Props) {
  // A region whose boundaries have not been imported yet has nothing to draw.
  if (frames.length === 0) return null

  const cycle = `${frames.length * HOLD}s`
  const timed = (index: number, extra = 0): CSSProperties => ({
    animationDuration: cycle,
    animationDelay: `${index * HOLD + extra}s`,
  })

  const at = (year: number) =>
    span && span.last > span.first ? ((year - span.first) / (span.last - span.first)) * 100 : 0
  // The sliding marker's keyframes are written for three stops, which is what
  // `heroFrames` draws. Any other count keeps the ticks and drops the slide.
  const slides = frames.length === 3
  const markerVars = Object.fromEntries(
    frames.map((frame, index) => [`--at-${index}`, `${at(frame.year)}%`]),
  ) as CSSProperties

  return (
    <div className="plate" aria-hidden="true">
      <div className="plate__map">
        <svg className="plate__svg" viewBox={PLATE_VIEWBOX} preserveAspectRatio="xMidYMid meet">
          {frames.map((frame, index) => (
            <path key={frame.year} className="plate__frame" d={frame.path} style={timed(index)} />
          ))}
        </svg>

        {frames.map((frame, index) =>
          (pins[index] ?? []).map((pin, order) => {
            const { left, top } = platePosition(pin.lng, pin.lat)
            return (
              <span
                key={`${frame.year}-${pin.pack}-${pin.slug}`}
                className="plate__pin"
                data-frame={index}
                style={{ left: `${left}%`, top: `${top}%`, ...timed(index, 0.5 + order * 0.35) }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="plate__face" src={pin.src} alt="" width={44} height={44} />
                <span className="plate__name">{pin.name}</span>
              </span>
            )
          }),
        )}

        <p className="plate__years">
          {frames.map((frame, index) => (
            <span key={frame.year} className="plate__year" style={timed(index)}>
              {formatYear(frame.year)}
            </span>
          ))}
        </p>
      </div>

      {span && (
        <div className="plate__timeline">
          <span className="plate__end">{formatYear(span.first)}</span>
          <span className="plate__rule" style={markerVars}>
            {frames.map((frame) => (
              <span key={frame.year} className="plate__tick" style={{ left: `${at(frame.year)}%` }} />
            ))}
            {slides && (
              <span className="plate__marker" style={{ animationDuration: cycle }} />
            )}
          </span>
          <span className="plate__end">{formatYear(span.last)}</span>
        </div>
      )}
    </div>
  )
}
