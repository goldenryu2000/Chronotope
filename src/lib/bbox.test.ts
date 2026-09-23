import { describe, expect, it } from 'vitest'
import {
  cameraBounds, contains, INVITE_HIDE, INVITE_SHOW, pad, viewportShare,
} from './bbox'

const INDIA = [66, 5, 97.6, 37.6] as const
const WORLD = [-180, -85, 180, 85] as const

describe('contains', () => {
  it('puts a figure inside the plate on it', () => {
    // Abhinavagupta, Kashmir.
    expect(contains(INDIA, 76, 34.5)).toBe(true)
  })

  it('leaves a figure outside it off', () => {
    // Laozi, in the state of Chu.
    expect(contains(INDIA, 112.173, 30.423)).toBe(false)
  })

  it('counts a figure exactly on the line as on the plate', () => {
    expect(contains(INDIA, 66, 5)).toBe(true)
    expect(contains(INDIA, 97.6, 37.6)).toBe(true)
  })

  it('is the identity on the world plate', () => {
    // The rule must cost the world atlas nothing, which is the whole reason
    // it can live in the engine rather than behind a region check.
    for (const [lng, lat] of [[112.173, 30.423], [-77, 39], [0, 0], [151, -33.8]]) {
      expect(contains(WORLD, lng, lat)).toBe(true)
    }
  })
})

describe('pad', () => {
  it('widens by a share of the plate, not a fixed distance', () => {
    expect(pad([0, 0, 10, 20], 0.1)).toEqual([-1, -2, 11, 22])
  })

  it('never claims latitude Web Mercator cannot draw', () => {
    const [, south, , north] = pad(WORLD, 0.2)
    expect(south).toBeGreaterThanOrEqual(-85.051129)
    expect(north).toBeLessThanOrEqual(85.051129)
  })

  it('never claims longitude past the antimeridian', () => {
    const [west, , east] = pad(WORLD, 0.2)
    expect(west).toBe(-180)
    expect(east).toBe(180)
  })
})

describe('cameraBounds', () => {
  /** A wide screen, which is where the aspect problem shows up. */
  const WIDE = { width: 1600, height: 950 }

  it('holds a reader inside a plate, with room to centre its coast', () => {
    const bounds = cameraBounds(INDIA, WIDE)
    expect(bounds).toBeDefined()
    const [[, south], [, north]] = bounds as [[number, number], [number, number]]
    expect(south).toBeLessThan(INDIA[1])
    expect(north).toBeGreaterThan(INDIA[3])
  })

  it('never cuts the plate off on a screen wider than it is', () => {
    /*
     * The bug this function exists for. MapLibre keeps the whole viewport
     * inside `maxBounds`, so bounds merely padded around a square-ish plate
     * make it zoom in until a quarter of India is on screen. The bounds must
     * be at least as wide as showing the whole plate requires.
     */
    const [[west], [east]] = cameraBounds(INDIA, WIDE) as [[number, number], [number, number]]
    const plateWidth = INDIA[2] - INDIA[0]
    const plateHeight = INDIA[3] - INDIA[1]
    // Roughly: the viewport's aspect applied to the plate's height.
    const needed = plateHeight * (WIDE.width / WIDE.height)
    expect(east - west).toBeGreaterThan(Math.max(plateWidth, needed * 0.8))
  })

  it('grows with the screen, so a wider window does not crop the plate', () => {
    const narrow = cameraBounds(INDIA, { width: 900, height: 950 }) as [[number, number], [number, number]]
    const wide = cameraBounds(INDIA, { width: 2400, height: 950 }) as [[number, number], [number, number]]
    expect(wide[1][0] - wide[0][0]).toBeGreaterThan(narrow[1][0] - narrow[0][0])
  })

  it('stays centred on the plate', () => {
    const [[west], [east]] = cameraBounds(INDIA, WIDE) as [[number, number], [number, number]]
    expect((west + east) / 2).toBeCloseTo((INDIA[0] + INDIA[2]) / 2, 5)
  })

  it('bounds nothing when the plate is the whole world', () => {
    // MapLibre 6.2 throws inside `constrainInternal` when asked to bound the
    // full 360°, before the map exists, so the atlas renders as a blank error
    // page. It is also the right answer: the world has no edges to be kept
    // inside of, and `renderWorldCopies: false` already gave the map its own.
    expect(cameraBounds(WORLD, WIDE)).toBeUndefined()
  })

  it('bounds nothing once the plate plus its margin reaches all the way round', () => {
    expect(cameraBounds([-170, -60, 170, 60], WIDE)).toBeUndefined()
  })

  it('bounds nothing rather than throwing on a viewport with no size', () => {
    // A container measured before layout. Returning bounds computed from zero
    // would hand MapLibre a degenerate box.
    expect(cameraBounds(INDIA, { width: 0, height: 0 })).toBeUndefined()
  })
})

describe('viewportShare', () => {
  /** What a 1600x950 viewport covers at a given zoom, centred on India. */
  const viewAt = (zoom: number): [number, number, number, number] => {
    const world = 512 * 2 ** zoom
    const lngSpan = (1600 / world) * 360
    // Rough, and rough is enough: the assertions below are about which side of
    // a threshold a zoom falls on, not about a fourth decimal place.
    const latSpan = (950 / world) * 360 * 0.78
    const [midLng, midLat] = [81.8, 21.3]
    return [midLng - lngSpan / 2, midLat - latSpan / 2, midLng + lngSpan / 2, midLat + latSpan / 2]
  }

  it('is nearly nothing at world view, which is why nothing is drawn there', () => {
    expect(viewportShare(INDIA, viewAt(1.6))).toBeLessThan(INVITE_HIDE)
  })

  it('is not enough at a zoom that merely has India on screen', () => {
    expect(viewportShare(INDIA, viewAt(3))).toBeLessThan(INVITE_SHOW)
  })

  it('is enough once somebody has gone to look at the subcontinent', () => {
    expect(viewportShare(INDIA, viewAt(4))).toBeGreaterThan(INVITE_SHOW)
  })

  it('stays high rather than falling away again when zoomed further in', () => {
    // Clipped by the plate's own area as well as the viewport's. Without that,
    // zooming past the point where the plate fills the screen would withdraw
    // the offer exactly when the reader is most interested.
    expect(viewportShare(INDIA, viewAt(6))).toBeGreaterThan(INVITE_SHOW)
  })

  it('is zero for a plate nowhere near the view', () => {
    expect(viewportShare(INDIA, [-60, 30, -40, 50])).toBe(0)
  })

  it('leaves room between showing and hiding, so a resting map does not flicker', () => {
    expect(INVITE_HIDE).toBeLessThan(INVITE_SHOW)
  })
})
