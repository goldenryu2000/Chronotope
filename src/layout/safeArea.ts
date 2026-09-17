/**
 * The part of the map nothing is drawn over.
 *
 * Every overlay on the atlas used to reserve space with its own hand-tuned rem
 * values that knew about the others: the tour player a right margin for the
 * panel, the panel a bottom reserve for the zoom buttons, "meanwhile, elsewhere"
 * a padding guess of all of them. Nothing measured what was actually on screen,
 * so every new overlay was a new overlap, and every camera move put its subject
 * at the centre of the viewport, which is where the tour card sat.
 *
 * This is the arithmetic half of the replacement: measured rectangles in, a
 * clear area out, and the camera and pan moves that keep a subject inside it.
 * It is pure so it can be tested without a layout engine. `measure.ts` is the
 * half that reads the DOM.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Viewport {
  width: number
  height: number
}

/** The overlays that shape the clear area, by the side of the screen they own. */
export interface Regions {
  top?: readonly Rect[]
  left?: Rect | null
  right?: Rect | null
  bottom?: readonly Rect[]
}

/** Breathing room between an overlay and whatever the camera frames. */
export const GAP = 16

/**
 * The least map worth keeping.
 *
 * Below this the reserves give way in proportion. A window narrow enough to
 * need it has overlays over its subject either way; this keeps camera maths
 * from dividing by a negative area.
 */
export const MIN_SAFE: Viewport = { width: 240, height: 180 }

export function insetsFor(viewport: Viewport, regions: Regions, gap = GAP): Insets {
  const top = regions.top?.length ? Math.max(...regions.top.map((r) => r.bottom)) + gap : 0
  const bottom = regions.bottom?.length
    ? viewport.height - Math.min(...regions.bottom.map((r) => r.top)) + gap
    : 0
  const left = regions.left ? regions.left.right + gap : 0
  const right = regions.right ? viewport.width - regions.right.left + gap : 0

  const [l, r] = yield2(left, right, viewport.width - MIN_SAFE.width)
  const [t, b] = yield2(top, bottom, viewport.height - MIN_SAFE.height)
  return { top: t, right: r, bottom: b, left: l }
}

/** Scales a pair of reserves down, in proportion, until they fit a budget. */
function yield2(a: number, b: number, budget: number): [number, number] {
  const sum = a + b
  if (sum <= budget || sum === 0) return [a, b]
  const scale = Math.max(0, budget) / sum
  return [a * scale, b * scale]
}

/**
 * How far content must move to sit inside the clear area.
 *
 * Positive x moves it right. Zero when it is already clear, so a caller can
 * skip the camera move entirely rather than animate nothing. Something bigger
 * than the clear area is aligned to its top-left, where a popover's heading and
 * a card's title are.
 */
export function nudge(rect: Rect, viewport: Viewport, insets: Insets, margin = 0): { x: number; y: number } {
  return {
    x: axis(rect.left, rect.right, insets.left + margin, viewport.width - insets.right - margin),
    y: axis(rect.top, rect.bottom, insets.top + margin, viewport.height - insets.bottom - margin),
  }
}

function axis(start: number, end: number, low: number, high: number): number {
  if (end - start > high - low) return low - start
  if (start < low) return low - start
  if (end > high) return high - end
  return 0
}

/** MapLibre's tile size: the world is 512px across at zoom 0. */
const TILE = 512

/** Web Mercator: a coordinate to world pixels at a zoom. */
export function project([lng, lat]: readonly [number, number], zoom: number): { x: number; y: number } {
  const size = TILE * 2 ** zoom
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat))
  const sin = Math.sin((clamped * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  }
}

export function unproject({ x, y }: { x: number; y: number }, zoom: number): [number, number] {
  const size = TILE * 2 ** zoom
  const lng = (x / size) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / size
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n))
  return [lng, lat]
}

/**
 * Where to point the camera so a view reads clearly.
 *
 * The authored centre goes in the middle of the clear area rather than the
 * middle of the screen. If that still leaves the subject under an overlay (a
 * stop's camera may sit several degrees off the figure it narrates), the centre
 * shifts just far enough to bring the subject `margin` inside the edge. Only as
 * far as needed: the author chose that framing, and a subject already in the
 * clear keeps it exactly.
 */
export function frame(
  center: readonly [number, number],
  zoom: number,
  subject: readonly [number, number] | null,
  viewport: Viewport,
  insets: Insets,
  margin = 0,
): [number, number] {
  const c = project(center, zoom)
  // The clear area's centre, as an offset from the screen's.
  const ox = (insets.left - insets.right) / 2
  const oy = (insets.top - insets.bottom) / 2
  const camera = { x: c.x - ox, y: c.y - oy }

  if (subject) {
    const s = project(subject, zoom)
    const halfW = viewport.width / 2
    const halfH = viewport.height / 2
    const shift = nudge(
      { left: s.x - camera.x + halfW, right: s.x - camera.x + halfW, top: s.y - camera.y + halfH, bottom: s.y - camera.y + halfH },
      viewport,
      insets,
      margin,
    )
    // Moving the subject right on screen is moving the camera left.
    camera.x -= shift.x
    camera.y -= shift.y
  }

  return unproject(camera, zoom)
}

/**
 * The smallest camera move that brings a subject into the clear area.
 *
 * `box` is what the subject paints, relative to its coordinate: a pin's dot and
 * its label, a popover hanging above its cluster. Null when it is already
 * clear, so nothing moves.
 *
 * A pan is tried first, and only a pan, because the reader chose the zoom. But
 * the map does not repeat and MapLibre keeps the world filling the screen, so
 * near world zoom there is almost nowhere to pan to: a figure in China at zoom
 * 1.6 cannot leave the right column that way. Then it zooms in, a quarter step
 * at a time, to the first zoom where a pan MapLibre would allow does clear it.
 */
export function reveal(
  subject: readonly [number, number],
  center: readonly [number, number],
  zoom: number,
  viewport: Viewport,
  insets: Insets,
  box: Rect,
  margin = 0,
  maxZoom = zoom + 3,
): { center: [number, number]; zoom: number } | null {
  const halfW = viewport.width / 2
  const halfH = viewport.height / 2

  const shiftAt = (s: { x: number; y: number }, camera: { x: number; y: number }) =>
    nudge(
      {
        left: s.x - camera.x + halfW + box.left,
        right: s.x - camera.x + halfW + box.right,
        top: s.y - camera.y + halfH + box.top,
        bottom: s.y - camera.y + halfH + box.bottom,
      },
      viewport,
      insets,
      margin,
    )

  let best: { center: [number, number]; zoom: number } | null = null

  for (let z = zoom; z <= maxZoom + 1e-9; z += 0.25) {
    const world = TILE * 2 ** z
    const s = project(subject, z)
    // Zooming happens about the screen centre, so the centre is where it was.
    const c = project(center, z)
    const shift = shiftAt(s, c)
    if (z === zoom && shift.x === 0 && shift.y === 0) return null

    const clampAxis = (value: number, half: number) =>
      world <= 2 * half ? world / 2 : Math.min(world - half, Math.max(half, value))
    const camera = { x: clampAxis(c.x - shift.x, halfW), y: clampAxis(c.y - shift.y, halfH) }
    best = { center: unproject(camera, z), zoom: z }

    const left = shiftAt(s, camera)
    if (left.x === 0 && left.y === 0) return best
  }

  return best
}
