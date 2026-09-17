import { PLATE } from '../read/heroFrames'
import type { Portrait } from '../read/landingPortraits'

interface PinOptions {
  /** At most this many pins on one plate. */
  count?: number
  /** Minimum distance between two pins, in degrees, so they never overlap. */
  apart?: number
}

const byKey = (a: Portrait, b: Portrait) =>
  a.pack.localeCompare(b.pack) || a.slug.localeCompare(b.slug)

/**
 * Which figures to pin on the hero plate for one year.
 *
 * Only figures alive, or attested, in that year. Shorter spans first: a
 * philosopher who lived sixty years says "this moment" in a way a dragon
 * attested for five thousand does not. Then round-robin across packs, so one
 * plate shows the range of what the atlas holds, and never two pins close
 * enough to overlap. Deterministic, so the static page is stable between
 * rebuilds.
 */
export function pinsForYear(
  portraits: readonly Portrait[],
  year: number,
  { count = 4, apart = 22 }: PinOptions = {},
): Portrait[] {
  const alive = portraits
    .filter((portrait) => portrait.start <= year && year <= portrait.end)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start) || byKey(a, b))

  const queues = new Map<string, Portrait[]>()
  for (const portrait of alive) {
    const queue = queues.get(portrait.pack) ?? []
    queue.push(portrait)
    queues.set(portrait.pack, queue)
  }
  const order = [...queues.keys()].sort()

  const picked: Portrait[] = []
  const clear = (candidate: Portrait) => picked.every((pin) =>
    Math.hypot(pin.lng - candidate.lng, pin.lat - candidate.lat) >= apart)

  while (picked.length < count && order.some((pack) => queues.get(pack)!.length > 0)) {
    for (const pack of order) {
      if (picked.length >= count) break
      const queue = queues.get(pack)!
      // Skip past anything too close to a pin already placed; it would only
      // ever be hidden under it.
      while (queue.length > 0) {
        const next = queue.shift()!
        if (clear(next)) {
          picked.push(next)
          break
        }
      }
    }
  }

  return picked
}

/**
 * A few portraits spread evenly over a pack's timeline, earliest to latest,
 * so a card shows the range of the pack at a glance.
 */
export function portraitStrip(portraits: readonly Portrait[], count: number): Portrait[] {
  const sorted = [...portraits].sort((a, b) => a.start - b.start || byKey(a, b))
  if (sorted.length <= count) return sorted
  if (count === 1) return [sorted[0]]
  const step = (sorted.length - 1) / (count - 1)
  return Array.from({ length: count }, (_, i) => sorted[Math.round(i * step)])
}

interface PackLike {
  slug: string
  title: string
  entityCount: number
}

/**
 * Which pack the primary "Open the atlas" button opens.
 *
 * Chosen from data, not named: the pack with the most portraits to show, which
 * is also the one the hero's pictures mostly come from. Ties go to the larger
 * pack, then the title.
 */
export function startPack<T extends PackLike>(
  packs: readonly T[],
  portraits: readonly Portrait[],
): T | undefined {
  const pictured = (slug: string) => portraits.filter((portrait) => portrait.pack === slug).length
  return [...packs].sort((a, b) =>
    pictured(b.slug) - pictured(a.slug)
    || b.entityCount - a.entityCount
    || a.title.localeCompare(b.title))[0]
}

/** Where a place sits on the hero plate, as percentages of its box. */
export function platePosition(lng: number, lat: number): { left: number; top: number } {
  const clamp = (value: number) => Math.min(97, Math.max(3, value))
  return {
    left: clamp(((lng - PLATE.west) / (PLATE.east - PLATE.west)) * 100),
    top: clamp(((PLATE.north - lat) / (PLATE.north - PLATE.south)) * 100),
  }
}

/** How many figures a card leaves unnamed after listing a few. */
export function othersCount(total: number, named: number): number {
  return Math.max(0, total - named)
}
