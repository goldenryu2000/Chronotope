/**
 * The zoomed detail track: a straight, unweighted window of years around the
 * current one.
 *
 * The overview track is era-weighted and packs up to a hundred centuries into
 * about 900 pixels, several years to a pixel. This window shows 120 years in
 * the same width, about seven pixels a year, so a reader can land on the exact
 * year they point at. Linear on purpose: inside a century nobody needs the era
 * weighting, and a year the same width everywhere is what makes it predictable.
 */
export const DETAIL_SPAN = 120

export interface DetailWindow {
  /** First year at the left edge. */
  from: number
  /** Year at the right edge. `to - from` is the span. */
  to: number
}

/** A window of `span` years centred on `year`, kept inside [start, end] at full width where possible. */
export function windowAround(year: number, start: number, end: number, span = DETAIL_SPAN): DetailWindow {
  if (end - start <= span) return { from: start, to: end }
  const from = Math.min(Math.max(year - span / 2, start), end - span)
  return { from, to: from + span }
}

/** The same window moved by `years`, stopped at the scale's ends without losing width. */
export function shiftWindow(window: DetailWindow, years: number, start: number, end: number): DetailWindow {
  const span = window.to - window.from
  const from = Math.min(Math.max(window.from + years, start), end - span)
  return { from, to: from + span }
}

/**
 * The whole year at a fraction of the window, clamped to its edges.
 *
 * Year 0 does not exist, so a pointer resting on it lands on the side it is
 * nearer: 1 CE from the right half, 1 BCE from the left.
 */
export function yearInWindow(window: DetailWindow, fraction: number): number {
  const clamped = Math.min(1, Math.max(0, fraction))
  const raw = window.from + clamped * (window.to - window.from)
  const year = Math.round(raw)
  if (year !== 0) return year
  return raw >= 0 ? 1 : -1
}

export function fractionOfYear(window: DetailWindow, year: number): number {
  return (year - window.from) / (window.to - window.from)
}

export interface DetailTick {
  year: number
  /** Every fifth year gets a taller tick. */
  mid: boolean
  /** Every tenth year is labelled. */
  label: boolean
}

export function detailTicks(window: DetailWindow): DetailTick[] {
  const ticks: DetailTick[] = []
  for (let year = Math.ceil(window.from); year <= Math.floor(window.to); year++) {
    if (year === 0) continue
    const label = year % 10 === 0
    ticks.push({ year, label, mid: !label && year % 5 === 0 })
  }
  return ticks
}
