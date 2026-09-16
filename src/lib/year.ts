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
 * What a reader typed, as a signed year, or null if it is not one.
 *
 * The inverse of `formatYear`, and forgiving about the forms people actually
 * type: `1492`, `1492 CE`, `AD 1492`, `350 BCE`, `350 B.C.`, `-350`. A minus
 * sign and an era word together (`-350 BCE`) are refused rather than guessed
 * at, because the reader could have meant either. There is no year 0.
 */
export function parseYear(input: string): number | null {
  // Dots are dropped only after a letter (B.C., A.D.), so `12.5` stays a
  // decimal and is refused instead of becoming 125.
  const text = input.trim().replace(/,/g, '').replace(/(?<=[A-Za-z])\./g, '').toUpperCase()
  const match = /^(?:(AD|CE)\s*)?(-)?(\d+)(?:\s*(BCE|BC|CE|AD))?$/.exec(text)
  if (!match) return null

  const [, prefix, minus, digits, suffix] = match
  if (prefix && suffix) return null

  const magnitude = Number(digits)
  if (magnitude === 0) return null

  const era = prefix ?? suffix
  const before = era === 'BCE' || era === 'BC'
  if (minus && era) return null

  return minus || before ? -magnitude : magnitude
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
