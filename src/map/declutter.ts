import type { ActiveEntity } from '../data/entitySpan'
import { project as mercator } from '../layout/safeArea'

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
  /** False when no side has room for the name without covering another mark or name. */
  label: boolean
  /** Which side of the mark the name is drawn on. */
  side: LabelSide
}

/**
 * Where a name sits around its mark, in the order they are tried.
 *
 * The corners come last, leaning off the mark's centre: in a crowd like the
 * Iranian plateau at world zoom every side of a pair was taken by a neighbour's
 * mark, and a corner was the only room left.
 */
export type LabelSide =
  | 'right' | 'left' | 'above' | 'below'
  | 'above-right' | 'below-right' | 'above-left' | 'below-left'
const SIDES: readonly LabelSide[] = [
  'right', 'left', 'above', 'below', 'above-right', 'below-right', 'above-left', 'below-left',
]

/** Half the pin's hit area — the radius a label must stay clear of. */
const PIN_RADIUS_PX = 16

/** Half a cluster badge, which is wider than a pin's dot. */
const CLUSTER_RADIUS_PX = 14

/** Rough label metrics at 0.78rem; exact enough to test for a collision. */
const LABEL_CHAR_PX = 6.2
const LABEL_HEIGHT_PX = 15
const LABEL_GAP_PX = 10
/** How far above or below its mark a name starts. Matches MapCanvas.css. */
const PIN_STACK_PX = 8
const CLUSTER_STACK_PX = 15

export interface Cluster {
  /** Stable across renders so React and the marker cache can track it. */
  id: string
  members: ActiveEntity[]
  at: { x: number; y: number }
  lngLat: [number, number]
  bounds: [[number, number], [number, number]]
  /**
   * The place every member shares, or null when they do not all share one.
   *
   * This used to be the most common place, falling back to the first member's,
   * which called Aristotle and Plato "2 in Stagira" and a pile of Greek and
   * Egyptian gods "Ugarit". Naming a place is a claim about every member.
   */
  place: string | null
  /** What the badge's label says: who is in it, not only how many. */
  name: string
  /** False when no side has room for the name without covering another mark or name. */
  label: boolean
  side: LabelSide
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
  selectedId: string | null = null,
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
        side: 'right',
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
    for (const { entity: e } of group) {
      minLng = Math.min(minLng, e.lng)
      maxLng = Math.max(maxLng, e.lng)
      minLat = Math.min(minLat, e.lat)
      maxLat = Math.max(maxLat, e.lat)
      sumLng += e.lng
      sumLat += e.lat
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
      place: sharedPlace(group.map((m) => m.entity)),
      name: clusterName(group.map((m) => m.entity), selectedId),
      label: true,
      side: 'right',
    })
  }

  placeLabels(placed, clusters, selectedId)
  return { placed, clusters }
}

/** The town a place starts with: "Athens" of "Athens, Greece". */
function town(place: string): string {
  return place.split(',')[0].trim()
}

/** The place every member shares, or null. See `Cluster.place`. */
export function sharedPlace(members: readonly ActiveEntity[]): string | null {
  if (members.length === 0) return null
  const first = town(members[0].place)
  return first && members.every((member) => town(member.place) === first) ? first : null
}

/**
 * What a cluster says when asked: "2 figures in Athens", or "31 figures nearby".
 *
 * "Figures" rather than "entities", which is the engine's word and not the
 * reader's, and rather than any one pack's noun (Rule 2).
 */
export function clusterCaption(count: number, place: string | null): string {
  return place ? `${count} figures in ${place}` : `${count} figures nearby`
}

/**
 * A cluster's label: the names in it, as far as a label has room for.
 *
 * A badge that only said "4" was the whole problem with zooming into a crowded
 * region: many figures share one coordinate (a pantheon at its cult centre), so
 * no zoom ever separates them, and the reader landed on a map of numbers with
 * one name among them. a bigger group by the figure
 * most worth leading with, and a count. Up to three are named in full: a trio
 * labelled "Lernaean Hydra +2" left Satyr with no name anywhere on the map. Whoever is selected leads, so the mark
 * says who the panel is showing; otherwise core figures lead halo ones.
 *
 * `compact` gives the short form at any size, for a crowd with no room for
 * every name: "Humbaba +2" said something where "Humbaba, Lamassu, Mermaid"
 * had no side to sit on and said nothing.
 */
export function clusterName(
  members: readonly ActiveEntity[],
  selectedId: string | null,
  compact = false,
): string {
  const rank = (entity: ActiveEntity) =>
    entity.id === selectedId ? 0 : entity.tier === 'core' ? 1 : 2
  const ordered = members
    .map((entity, index) => ({ entity, index }))
    .sort((a, b) => rank(a.entity) - rank(b.entity) || a.index - b.index)
    .map(({ entity }) => entity)

  if (!compact && ordered.length <= 3) return ordered.map((entity) => entity.name).join(', ')
  return `${ordered[0].name} +${ordered.length - 1}`
}

/**
 * Gives every mark's name a side to sit on, or hides it when none has room.
 *
 * A name used to go to the right or not at all. Two figures a few dozen pixels
 * apart on a line (Satyr just west of the Lernaean Hydra) then showed two dots
 * and one name, the other hidden because it would have covered its neighbour.
 * Each name now tries right, left, above, below and then the four corners, and
 * takes the first side
 * that covers no other mark (it would steal that mark's clicks) and no name
 * already placed (two names over each other read as neither).
 *
 * A cluster whose full list of names fits nowhere tries its short form
 * ("Humbaba +2") on every side before it goes unnamed.
 *
 * Whoever is selected is placed first, so their name gets first choice. Then
 * the clusters, largest first, and only then the other pins: a lone pin names
 * one figure and a cluster names several, and when the pins went first on the
 * world map at opening, Thessaly's ten and both Iranian pairs had no name at all.
 */
function placeLabels(placed: Placed[], clusters: Cluster[], selectedId: string | null): void {
  type Box = { left: number; right: number; top: number; bottom: number }
  const marks = [
    ...placed.map((item) => ({ owner: item as object, at: item.at, radius: PIN_RADIUS_PX })),
    ...clusters.map((item) => ({ owner: item as object, at: item.at, radius: CLUSTER_RADIUS_PX })),
  ]
  const names: Box[] = []

  const boxFor = (at: Point, side: LabelSide, width: number, gap: number, stack: number): Box => {
    const middle = { top: at.y - LABEL_HEIGHT_PX / 2, bottom: at.y + LABEL_HEIGHT_PX / 2 }
    const centred = { left: at.x - width / 2, right: at.x + width / 2 }
    const up = { top: at.y - stack - LABEL_HEIGHT_PX, bottom: at.y - stack }
    const down = { top: at.y + stack, bottom: at.y + stack + LABEL_HEIGHT_PX }
    switch (side) {
      case 'right': return { left: at.x + gap, right: at.x + gap + width, ...middle }
      case 'left': return { left: at.x - gap - width, right: at.x - gap, ...middle }
      case 'above': return { ...centred, ...up }
      case 'below': return { ...centred, ...down }
      case 'above-right': return { left: at.x, right: at.x + width, ...up }
      case 'below-right': return { left: at.x, right: at.x + width, ...down }
      case 'above-left': return { left: at.x - width, right: at.x, ...up }
      case 'below-left': return { left: at.x - width, right: at.x, ...down }
    }
  }

  const free = (owner: object, box: Box) =>
    !marks.some(
      (mark) =>
        mark.owner !== owner &&
        mark.at.x + mark.radius > box.left &&
        mark.at.x - mark.radius < box.right &&
        mark.at.y + mark.radius > box.top &&
        mark.at.y - mark.radius < box.bottom,
    ) &&
    !names.some(
      (other) =>
        other.right > box.left && other.left < box.right && other.bottom > box.top && other.top < box.bottom,
    )

  /** Places the first text that fits on any side, and returns it, or null. */
  const place = (owner: Placed | Cluster, texts: readonly string[], gap: number, stack: number) => {
    for (const text of texts) {
      const width = text.length * LABEL_CHAR_PX
      for (const side of SIDES) {
        const box = boxFor(owner.at, side, width, gap, stack)
        if (free(owner, box)) {
          owner.label = true
          owner.side = side
          names.push(box)
          return text
        }
      }
    }
    owner.label = false
    owner.side = 'right'
    return null
  }

  const pin = (item: Placed) => place(item, [item.entity.name], LABEL_GAP_PX, PIN_STACK_PX)
  const selected = placed.find((item) => item.entity.id === selectedId)
  if (selected) pin(selected)
  const largestFirst = [...clusters].sort((a, b) => b.members.length - a.members.length)
  for (const item of largestFirst) {
    const short = clusterName(item.members, selectedId, true)
    const texts = short === item.name ? [item.name] : [item.name, short]
    const fitted = place(item, texts, CLUSTER_RADIUS_PX + LABEL_GAP_PX / 2, CLUSTER_STACK_PX)
    if (fitted) item.name = fitted
  }
  for (const item of placed) if (item !== selected) pin(item)
}

/** What clicking a cluster should do: zoom in far enough to part it, or list it. */
export type ClusterMove = { kind: 'zoom'; zoom: number } | { kind: 'list' }

/**
 * Zoom when zooming can separate the members; list them when it cannot.
 *
 * This was a fixed rule: below zoom 4.2 fit the bounds (capped at 5.2),
 * otherwise open the list. Figures a fraction of a degree apart (Satyr, the
 * Hydra and Pegasus around Lerna) were still one "3" at 5.2, and clicking it
 * then listed them instead of parting them, though zoom 6 would have.
 *
 * Members that stay within `COLLIDE_PX` even at the map's maximum zoom are one
 * spot for this purpose: a pantheon at its cult centre never separates. If
 * everything is one spot, or the map is already past the zoom that parts the
 * spots, the list is the answer. Otherwise the target leaves twice the collision
 * distance between the closest spots, so names have room, capped at the
 * maximum zoom.
 */
export function clusterMove(members: readonly ActiveEntity[], zoom: number, maxZoom: number): ClusterMove {
  // World pixels at zoom 0; every distance scales by 2^z from here.
  const points = members.map((entity) => mercator([entity.lng, entity.lat], 0))
  const scale = 2 ** maxZoom

  // Single-link groups of members that stay together even at maxZoom.
  const spot = points.map((_, index) => index)
  const root = (i: number): number => (spot[i] === i ? i : (spot[i] = root(spot[i])))
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)
      if (d * scale < COLLIDE_PX) spot[root(i)] = root(j)
    }
  }

  let closest = Infinity
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (root(i) === root(j)) continue
      closest = Math.min(closest, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y))
    }
  }
  if (!Number.isFinite(closest)) return { kind: 'list' }

  const parts = Math.log2(COLLIDE_PX / closest)
  if (zoom >= parts) return { kind: 'list' }
  const roomy = Math.log2((COLLIDE_PX * 2) / closest)
  return { kind: 'zoom', zoom: Math.min(maxZoom, roomy) }
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

