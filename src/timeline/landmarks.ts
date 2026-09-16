import { formatYear } from '../lib/year'

/**
 * The years where something visibly changes on the map.
 *
 * A raw year is rarely what a reader is after: borders redraw at fixed
 * snapshots and pins come and go with whole lives, so landing on 1491 instead
 * of 1492 can be the difference between two maps. These are the moments the
 * timeline lets a reader jump between, instead of hunting for them pixel by
 * pixel.
 */
export type LandmarkKind = 'border' | 'era' | 'layer' | 'arrival' | 'departure'

export interface Landmark {
  year: number
  /** One short phrase per thing that happens this year, most map-changing first. */
  labels: string[]
  kinds: LandmarkKind[]
}

export interface LandmarkSources {
  /** The scale's ends. Anything outside is dropped, and the start itself is not a moment. */
  start: number
  end: number
  borderChanges: readonly number[]
  eras: readonly { label: string; start: number }[]
  /** Active spans, as the map shows them: on from `from`, gone the year after `to`. */
  entities: readonly { name: string; from: number; to: number }[]
  /** Lit layers only. */
  spans: readonly { name: string; from: number; to: number }[]
}

/** Borders first: a border change repaints the whole map, a pin is one dot. */
const PRIORITY: Record<LandmarkKind, number> = {
  border: 0,
  era: 1,
  layer: 2,
  arrival: 3,
  departure: 4,
}

/** The year after `year`, skipping the year 0 this atlas does not have. */
const yearAfter = (year: number) => (year === -1 ? 1 : year + 1)

export function buildLandmarks(sources: LandmarkSources): Landmark[] {
  const moments: { year: number; label: string; kind: LandmarkKind; order: number }[] = []
  const add = (year: number, label: string, kind: LandmarkKind) => {
    if (year <= sources.start || year > sources.end) return
    moments.push({ year, label, kind, order: moments.length })
  }

  for (const year of sources.borderChanges) add(year, 'Borders redraw', 'border')
  for (const era of sources.eras) add(era.start, `${era.label} begins`, 'era')
  for (const span of sources.spans) {
    add(span.from, `${span.name} begins`, 'layer')
    add(span.to, `${span.name} ends`, 'layer')
  }
  for (const entity of sources.entities) {
    add(entity.from, `${entity.name} appears`, 'arrival')
    add(yearAfter(entity.to), `${entity.name} leaves`, 'departure')
  }

  moments.sort((a, b) => a.year - b.year || PRIORITY[a.kind] - PRIORITY[b.kind] || a.order - b.order)

  const landmarks: Landmark[] = []
  for (const moment of moments) {
    const last = landmarks[landmarks.length - 1]
    if (last && last.year === moment.year) {
      // The same border change can arrive twice (e.g. two snapshots folded
      // into one year); say it once.
      if (!last.labels.includes(moment.label)) last.labels.push(moment.label)
      if (!last.kinds.includes(moment.kind)) last.kinds.push(moment.kind)
    } else {
      landmarks.push({ year: moment.year, labels: [moment.label], kinds: [moment.kind] })
    }
  }
  return landmarks
}

/** A one-line description for a tooltip or screen reader. */
export function describeLandmark(landmark: Landmark): string {
  const shown = landmark.labels.slice(0, 3).join(' · ')
  const rest = landmark.labels.length - 3
  return `${formatYear(landmark.year)}: ${shown}${rest > 0 ? ` and ${rest} more` : ''}`
}

/** The first landmark strictly after `year`, or null. Landmarks must be sorted. */
export function nextLandmark(landmarks: readonly Landmark[], year: number): Landmark | null {
  return landmarks.find((landmark) => landmark.year > year) ?? null
}

/** The last landmark strictly before `year`, or null. Landmarks must be sorted. */
export function previousLandmark(landmarks: readonly Landmark[], year: number): Landmark | null {
  return landmarks.findLast((landmark) => landmark.year < year) ?? null
}
