import type { ActiveEntity } from '../data/entitySpan'

/** Screen distance under which two pins are treated as sitting on each other. */
export const COLLIDE_PX = 30

export interface Placed {
  entity: ActiveEntity
  /** Screen position of the true coordinate. */
  anchor: { x: number; y: number }
  /** Where the pin is actually drawn — equal to the anchor unless fanned. */
  at: { x: number; y: number }
  /** True when the pin was moved and needs a line back to its anchor. */
  offset: boolean
  /** False when showing the name would cover a different pin. */
  label: boolean
}

/** Half the pin's hit area — the radius a label must stay clear of. */
const PIN_RADIUS_PX = 16

/** Rough label metrics at 0.78rem; exact enough to test for a collision. */
const LABEL_CHAR_PX = 6.2
const LABEL_HEIGHT_PX = 15
const LABEL_GAP_PX = 10

export interface Cluster {
  /** Stable across renders so React and the marker cache can track it. */
  id: string
  members: ActiveEntity[]
  at: { x: number; y: number }
  lngLat: [number, number]
  bounds: [[number, number], [number, number]]
  place: string
}

export interface Layout {
  placed: Placed[]
  clusters: Cluster[]
}

type Point = { x: number; y: number }

/**
 * Decides where pins go when several land on the same spot or close together.
 *
 * Instead of chaotic radial fanning with overlapping lines, entities that sit
 * close together are grouped into a clean cluster badge. Clicking a cluster
 * smoothly zooms to its geographical bounds or presents a Location Popover Card.
 */
export function layoutPins(
  entities: readonly ActiveEntity[],
  project: (entity: ActiveEntity) => Point,
): Layout {
  const points = entities.map((entity) => ({ entity, point: project(entity) }))

  // Single-link grouping.
  const groups: { entity: ActiveEntity; point: Point }[][] = []
  const taken = new Set<number>()

  for (let i = 0; i < points.length; i++) {
    if (taken.has(i)) continue
    const group = [points[i]]
    taken.add(i)

    for (let j = i + 1; j < points.length; j++) {
      if (taken.has(j)) continue
      const near = group.some(
        (member) => Math.hypot(member.point.x - points[j].point.x, member.point.y - points[j].point.y) < COLLIDE_PX,
      )
      if (near) {
        group.push(points[j])
        taken.add(j)
      }
    }

    groups.push(group)
  }

  const placed: Placed[] = []
  const clusters: Cluster[] = []

  for (const group of groups) {
    if (group.length === 1) {
      placed.push({
        entity: group[0].entity,
        anchor: group[0].point,
        at: group[0].point,
        offset: false,
        label: true,
      })
      continue
    }

    const anchor = centroid(group.map((member) => member.point))
    const id = clusterId(group.map((member) => member.entity))

    // Calculate geographic center and bounds
    let minLng = group[0].entity.lng
    let maxLng = group[0].entity.lng
    let minLat = group[0].entity.lat
    let maxLat = group[0].entity.lat
    let sumLng = 0
    let sumLat = 0

    const placeCounts = new Map<string, number>()
    for (const member of group) {
      const e = member.entity
      minLng = Math.min(minLng, e.lng)
      maxLng = Math.max(maxLng, e.lng)
      minLat = Math.min(minLat, e.lat)
      maxLat = Math.max(maxLat, e.lat)
      sumLng += e.lng
      sumLat += e.lat

      const placeName = e.place.split(',')[0].trim()
      placeCounts.set(placeName, (placeCounts.get(placeName) ?? 0) + 1)
    }

    // Most common place name in cluster
    let primaryPlace = group[0].entity.place
    let maxCount = 0
    for (const [name, count] of placeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count
        primaryPlace = name
      }
    }

    const lngLat: [number, number] = [sumLng / group.length, sumLat / group.length]
    const bounds: [[number, number], [number, number]] = [
      [minLng, minLat],
      [maxLng, maxLat],
    ]

    clusters.push({
      id,
      members: group.map((m) => m.entity),
      at: anchor,
      lngLat,
      bounds,
      place: primaryPlace,
    })
  }

  hideCollidingLabels(placed)
  return { placed, clusters }
}

/**
 * Drops labels that would sit on top of another pin.
 */
function hideCollidingLabels(placed: Placed[]): void {
  for (const item of placed) {
    const width = item.entity.name.length * LABEL_CHAR_PX
    const box = {
      left: item.at.x + LABEL_GAP_PX,
      right: item.at.x + LABEL_GAP_PX + width,
      top: item.at.y - LABEL_HEIGHT_PX / 2,
      bottom: item.at.y + LABEL_HEIGHT_PX / 2,
    }

    item.label = !placed.some((other) => {
      if (other === item) return false
      return (
        other.at.x + PIN_RADIUS_PX > box.left &&
        other.at.x - PIN_RADIUS_PX < box.right &&
        other.at.y + PIN_RADIUS_PX > box.top &&
        other.at.y - PIN_RADIUS_PX < box.bottom
      )
    })
  }
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / points.length, y: sum.y / points.length }
}

/** Membership-derived, so the same pile keeps its identity between frames. */
function clusterId(members: ActiveEntity[]): string {
  return members
    .map((entity) => entity.id)
    .sort()
    .join('+')
}

