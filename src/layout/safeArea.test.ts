import { describe, expect, it } from 'vitest'
import { frame, insetsFor, MIN_SAFE, nudge, project, reveal, unproject } from './safeArea'

const viewport = { width: 1440, height: 900 }
const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

describe('insetsFor', () => {
  it('is all zero when nothing sits over the map', () => {
    expect(insetsFor(viewport, {}, 16)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })

  it('reserves each region plus the gap', () => {
    const insets = insetsFor(
      viewport,
      {
        top: [rect(20, 20, 145, 49), rect(553, 20, 887, 107)],
        left: rect(20, 64, 356, 690),
        right: rect(1084, 64, 1420, 690),
        bottom: [rect(256, 692, 1184, 876)],
      },
      16,
    )
    expect(insets).toEqual({ top: 123, right: 372, bottom: 224, left: 372 })
  })

  it('shrinks the reserves rather than leave no map at all', () => {
    const insets = insetsFor(
      { width: 700, height: 400 },
      { left: rect(0, 0, 300, 400), right: rect(400, 0, 700, 400), bottom: [rect(0, 300, 700, 400)] },
      0,
    )
    expect(700 - insets.left - insets.right).toBeCloseTo(MIN_SAFE.width)
    // Kept in proportion, so the column that was bigger still reserves more.
    expect(insets.left).toBeCloseTo(insets.right)
    expect(400 - insets.top - insets.bottom).toBeGreaterThanOrEqual(MIN_SAFE.height - 1e-9)
  })
})

describe('nudge', () => {
  const insets = { top: 100, right: 400, bottom: 200, left: 50 }

  it('leaves something already in the clear alone', () => {
    expect(nudge(rect(500, 300, 520, 320), viewport, insets)).toEqual({ x: 0, y: 0 })
  })

  it('moves content out from under the right column', () => {
    // Right edge of the clear area is 1440 - 400 = 1040.
    expect(nudge(rect(1100, 300, 1120, 320), viewport, insets)).toEqual({ x: -80, y: 0 })
  })

  it('moves content up from behind the dock and down from under the top bar', () => {
    expect(nudge(rect(500, 760, 520, 780), viewport, insets)).toEqual({ x: 0, y: -80 })
    expect(nudge(rect(500, 40, 520, 60), viewport, insets)).toEqual({ x: 0, y: 60 })
  })

  it('honours a margin', () => {
    expect(nudge(rect(1030, 300, 1035, 320), viewport, insets, 20)).toEqual({ x: -15, y: 0 })
  })

  it('pins something taller than the clear area to its top edge', () => {
    expect(nudge(rect(500, 50, 520, 850), viewport, insets)).toEqual({ x: 0, y: 50 })
  })
})

describe('mercator', () => {
  it('round-trips', () => {
    const [lng, lat] = unproject(project([116.99, 35.6], 4.6), 4.6)
    expect(lng).toBeCloseTo(116.99, 9)
    expect(lat).toBeCloseTo(35.6, 9)
  })
})

describe('frame', () => {
  const zoom = 4.6
  /** Where a coordinate lands on screen once the camera sits at `center`. */
  const screen = (point: [number, number], center: [number, number]) => {
    const p = project(point, zoom)
    const c = project(center, zoom)
    return { x: p.x - c.x + viewport.width / 2, y: p.y - c.y + viewport.height / 2 }
  }

  it('is the authored centre when nothing covers the map', () => {
    const center = frame([45, 31], zoom, null, viewport, { top: 0, right: 0, bottom: 0, left: 0 })
    expect(center[0]).toBeCloseTo(45, 9)
    expect(center[1]).toBeCloseTo(31, 9)
  })

  it('puts the authored centre in the middle of the clear area, not the screen', () => {
    const insets = { top: 120, right: 380, bottom: 230, left: 380 }
    const at = screen([45, 31], frame([45, 31], zoom, null, viewport, insets))
    expect(at.x).toBeCloseTo((380 + (1440 - 380)) / 2, 6)
    expect(at.y).toBeCloseTo((120 + (900 - 230)) / 2, 6)
  })

  it('pulls a subject the authored centre leaves under a column back into the clear', () => {
    const insets = { top: 120, right: 380, bottom: 230, left: 380 }
    // Six degrees east at zoom 4.6 is ~206px, and the clear half-width is 340px,
    // so this one fits already; twelve degrees does not.
    const subject: [number, number] = [57, 31]
    const at = screen(subject, frame([45, 31], zoom, subject, viewport, insets, 40))
    expect(at.x).toBeCloseTo(1440 - 380 - 40, 6)
  })

  it('leaves a subject that is already clear exactly where the author put it', () => {
    const insets = { top: 120, right: 380, bottom: 230, left: 380 }
    const withSubject = frame([45, 31], zoom, [46, 31.5], viewport, insets, 40)
    const without = frame([45, 31], zoom, null, viewport, insets, 40)
    expect(withSubject[0]).toBeCloseTo(without[0], 9)
    expect(withSubject[1]).toBeCloseTo(without[1], 9)
  })
})

describe('reveal', () => {
  const insets = { top: 123, right: 372, bottom: 238, left: 0 }
  const box = { left: -8, top: -8, right: 90, bottom: 8 }

  it('does nothing for a subject already in the clear', () => {
    expect(reveal([0, 20], [0, 20], 3, viewport, insets, box, 16)).toBeNull()
  })

  it('pans without zooming when panning is enough', () => {
    const move = reveal([60, 20], [40, 20], 4, viewport, insets, box, 16)!
    expect(move.zoom).toBe(4)
    const p = project([60, 20], 4)
    const c = project(move.center, 4)
    expect(p.x - c.x + viewport.width / 2 + box.right).toBeCloseTo(1440 - 372 - 16, 6)
  })

  it('zooms in as little as it can when the world edge stops the pan', () => {
    // Zoom 1.6: the world is ~1552px across, barely wider than the screen, so
    // a pin in China cannot pan clear of a 372px column.
    const start: [number, number] = [0, 20]
    const move = reveal([116, 35], start, 1.6, viewport, insets, box, 16, 5)!
    expect(move.zoom).toBeGreaterThan(1.6)
    expect(move.zoom).toBeLessThan(5)
    const p = project([116, 35], move.zoom)
    const c = project(move.center, move.zoom)
    expect(p.x - c.x + viewport.width / 2 + box.right).toBeLessThanOrEqual(1440 - 372 - 16 + 1e-6)
    // And the camera it lands on is one MapLibre would not clamp.
    const world = 512 * 2 ** move.zoom
    expect(c.x).toBeLessThanOrEqual(world - viewport.width / 2 + 1e-6)
  })
})
