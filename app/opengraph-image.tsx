import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { SITE_IMAGE } from '@/src/lib/site'

/**
 * The picture a shared link carries, for every route that has none of its own.
 *
 * Rendered once at build and cached, like any route handler that reads no
 * request. Drawn in the rustic theme, the default a first visitor sees, so the
 * preview and the page agree. The colours are rustic.css's tokens copied as
 * hex: this is a PNG drawn by Satori, which has no stylesheet to read them
 * from.
 *
 * Set in EB Garamond, the display face the theme names first. The files are
 * checked in beside src/og/OFL.txt rather than fetched, so a build never
 * depends on a font CDN being up.
 */

export const alt = SITE_IMAGE.alt
export const size = { width: SITE_IMAGE.width, height: SITE_IMAGE.height }
export const contentType = SITE_IMAGE.type

const PAPER = '#faf4e6'
const PAPER_AGED = '#e4d9bf'
const INK = '#221b12'
const INK_SOFT = '#4e412f'
const INK_FAINT = '#86765d'
const RULE = '#cbb994'
const ACCENT = '#9c3a24'

const font = (file: string) => readFile(join(process.cwd(), 'src/og', file))

/** Lines of latitude and longitude on an orthographic globe, off to the right. */
function Graticule() {
  const cx = 300
  const cy = 300
  const r = 290
  const meridians = [-75, -50, -25, 0, 25, 50, 75].map((deg) => {
    const rx = Math.abs(Math.sin((deg * Math.PI) / 180)) * r
    return <ellipse key={`m${deg}`} cx={cx} cy={cy} rx={rx} ry={r} />
  })
  const parallels = [-60, -30, 0, 30, 60].map((deg) => {
    const y = cy - Math.sin((deg * Math.PI) / 180) * r
    const half = Math.cos((deg * Math.PI) / 180) * r
    return <line key={`p${deg}`} x1={cx - half} y1={y} x2={cx + half} y2={y} />
  })
  return (
    <svg
      width="600"
      height="600"
      viewBox="0 0 600 600"
      style={{ position: 'absolute', right: -170, top: -21 }}
    >
      <g fill="none" stroke={RULE} strokeWidth="1.5" opacity="0.7">
        <circle cx={cx} cy={cy} r={r} strokeWidth="2.5" />
        {meridians}
        {parallels}
      </g>
    </svg>
  )
}

/** The favicon's mark: a pin inside the timeline's arc, with its knob. */
function Mark() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <path
        d="M43 12.95 A22 22 0 1 1 21 12.95"
        fill="none"
        stroke={INK}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="43" cy="12.95" r="5" fill={ACCENT} />
      <path
        d="M32 45 C27.2 39.2 23 34.6 23 29.5 A9 9 0 1 1 41 29.5 C41 34.6 36.8 39.2 32 45 Z"
        fill={ACCENT}
      />
      <circle cx="32" cy="29.5" r="3.2" fill={PAPER} />
    </svg>
  )
}

export default async function Image() {
  const [regular, medium, italic] = await Promise.all([
    font('eb-garamond-latin-400-normal.woff'),
    font('eb-garamond-latin-500-normal.woff'),
    font('eb-garamond-latin-400-italic.woff'),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          backgroundColor: PAPER,
          backgroundImage: `radial-gradient(circle at 30% 40%, ${PAPER} 45%, ${PAPER_AGED} 130%)`,
          fontFamily: 'EB Garamond',
          color: INK,
        }}
      >
        {/* Clipped to the plate, so the globe sits inside the border, not over it. */}
        <div
          style={{
            position: 'absolute',
            top: 36,
            left: 36,
            right: 36,
            bottom: 36,
            display: 'flex',
            overflow: 'hidden',
          }}
        >
          <Graticule />
        </div>

        {/* A plate's ruled border, doubled like an engraved map's. */}
        <div
          style={{
            position: 'absolute',
            top: 28,
            left: 28,
            right: 28,
            bottom: 28,
            border: `1.5px solid ${INK_FAINT}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 36,
            left: 36,
            right: 36,
            bottom: 36,
            border: `1px solid ${RULE}`,
          }}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 96px',
            width: '100%',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <Mark />
            <div style={{ fontSize: 40, fontWeight: 500, letterSpacing: '0.2em' }}>
              CHRONOTOPE
            </div>
          </div>

          <div
            style={{
              marginTop: 52,
              fontSize: 76,
              lineHeight: 1.08,
              maxWidth: 820,
            }}
          >
            Pick a year. Watch the world redraw.
          </div>

          <div
            style={{
              marginTop: 28,
              fontSize: 34,
              fontStyle: 'italic',
              lineHeight: 1.35,
              color: INK_SOFT,
              maxWidth: 690,
            }}
          >
            Five thousand years of borders, with the philosophers, gods and creatures of each
            moment.
          </div>

          {/* The timeline the reader drags, as a scale bar. */}
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 56, width: 520 }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: ACCENT }} />
            <div style={{ flex: 1, height: 2, backgroundColor: INK_FAINT }} />
            <div style={{ width: 2, height: 14, backgroundColor: INK_FAINT }} />
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'EB Garamond', data: regular, style: 'normal', weight: 400 },
        { name: 'EB Garamond', data: medium, style: 'normal', weight: 500 },
        { name: 'EB Garamond', data: italic, style: 'italic', weight: 400 },
      ],
    },
  )
}
