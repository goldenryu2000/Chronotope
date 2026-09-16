/**
 * Plain signed years: -384 is 384 BCE, 1650 is 1650 CE.
 *
 * Not astronomical numbering, so there is no year 0. This matches both the
 * upstream border data and what a contributor reads on Wikipedia, at the cost
 * of arithmetic that is off by one across the epoch boundary — which is what
 * `yearsBetween` exists to absorb.
 */
export function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : `${year} CE`
}

/**
 * Elapsed years between two signed years, accounting for the absent year 0.
 *
 * Note that the span and timeline-scale code deliberately does *not* call
 * this, which is why the only importer today is this function's own test. A
 * span's width in pixels, a pin's fade near its edge and an era's share of the
 * track are all positions on a number line, not counts of elapsed years: the
 * missing year 0 is a one-pixel-wide fiction there, and correcting for it
 * would put every span one year out of step with the axis it is drawn
 * against. Subtracting by hand at those sites is intentional. Use
 * `yearsBetween` wherever the answer is shown to a reader as a duration.
 */
export function yearsBetween(a: number, b: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const crossesEpoch = lo < 0 && hi > 0
  return hi - lo - (crossesEpoch ? 1 : 0)
}
