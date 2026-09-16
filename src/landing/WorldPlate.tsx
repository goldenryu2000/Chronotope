import { PLATE_VIEWBOX, type HeroFrame } from '../read/heroFrames'
import './WorldPlate.css'

interface Props {
  frames: readonly HeroFrame[]
}

/**
 * The claim, drawn instead of described.
 *
 * The page says the map is redrawn to match a year. Rather than illustrate
 * that with a picture of something else, this is the same `boundaries` table
 * the atlas draws, at three years, cross-fading. Watching Eurasia repartition
 * itself says more in four seconds than the paragraph above it does.
 *
 * No JavaScript and no hydration: three paths, three labels, and a CSS
 * animation offset by a third of its cycle each. It runs before React has
 * loaded and it runs if React never loads.
 */
export default function WorldPlate({ frames }: Props) {
  // A region whose boundaries have not been imported yet has nothing to draw.
  // The hero then stands on its own type rather than framing an empty box.
  if (frames.length === 0) return null

  const cycle = `${frames.length * 6}s`

  return (
    <div className="plate" aria-hidden="true">
      <svg
        className="plate__svg"
        viewBox={PLATE_VIEWBOX}
        preserveAspectRatio="xMidYMid slice"
      >
        {frames.map((frame, index) => (
          <path
            key={frame.year}
            className="plate__frame"
            d={frame.path}
            style={{ animationDuration: cycle, animationDelay: `${index * 6}s` }}
          />
        ))}
      </svg>

      {/*
        * The year is what makes the dissolve legible. Without it two similar
        * world maps trading places reads as a flicker; with it, it reads as
        * time passing — which is the one idea the page has to land.
        */}
      <p className="plate__years">
        {frames.map((frame, index) => (
          <span
            key={frame.year}
            className="plate__year"
            style={{ animationDuration: cycle, animationDelay: `${index * 6}s` }}
          >
            {frame.year < 0 ? `${Math.abs(frame.year)} BCE` : `${frame.year} CE`}
          </span>
        ))}
      </p>
    </div>
  )
}
