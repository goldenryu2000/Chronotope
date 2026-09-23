import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { hasEdges, type BBox } from '../lib/bbox'
import { token } from '../theme/themes'

/**
 * A plate drawn inside this one, as the map offers it.
 *
 * Deliberately says nothing about regions, parents or India. The engine is
 * handed a rectangle, a name and a destination, which is the whole of what it
 * needs to draw a way in (Rule 3). Who is inside whom is decided in
 * `src/read/regionKin.ts`, from a column in the database.
 */
export interface Doorway {
  /** Stable across renders; used for the source and layer ids. */
  id: string
  /** What the label reads, and what the reader is being offered. */
  title: string
  /** One line under it, the plate's own words for itself. */
  subtitle: string
  bbox: BBox
  /** Where clicking goes. */
  href: string
}

export const NEATLINE_SOURCE_ID = 'plate-edge-source'
export const NEATLINE_LAYER_ID = 'plate-edge'

export const DOORWAY_SOURCE_PREFIX = 'doorway-source-'
export const DOORWAY_LINE_PREFIX = 'doorway-line-'

export const doorwaySourceId = (id: string) => `${DOORWAY_SOURCE_PREFIX}${id}`
export const doorwayLineId = (id: string) => `${DOORWAY_LINE_PREFIX}${id}`

/** The rectangle, as a closed ring. */
export function frameOf(bbox: BBox): FeatureCollection {
  const [west, south, east, north] = bbox
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [west, south], [east, south], [east, north], [west, north], [west, south],
        ],
      },
    }],
  }
}

/**
 * Every colour here comes from `token()`. Rule 1.
 */
function framePaint() {
  return {
    'line-color': token('--map-doorway'),
    'line-width': 1.2,
    'line-opacity': 0.9,
    // A long dash with wide gaps, which is the printed atlas's own mark for
    // "this rectangle is shown larger on another plate" rather than for a
    // border. It has to be unmistakably *not* a frontier: every other line on
    // this map is one.
    'line-dasharray': [5, 4] as [number, number],
  }
}

/**
 * Draws the plate's own edge, where it has one.
 *
 * A regional archive is cut to its bbox, so the land simply stops on a
 * straight line and the parchment meets the sea at a right angle. Unmarked
 * that reads as a rendering fault; a thin rule along it is the neatline a
 * printed plate has always had, and it turns the same pixels into a deliberate
 * edge. Solid and quiet, against the doorway frame's dashes, because one says
 * "this is where the plate ends" and the other says "there is more here".
 *
 * Nothing is drawn for a plate that reaches all the way round: the world map's
 * edge is the map's edge, and a rule along the Mercator limit would be a line
 * across the top of the world that means nothing.
 */
export function addNeatline(map: MapLibreMap, bbox: BBox): void {
  if (!hasEdges(bbox)) return
  if (!map.getSource(NEATLINE_SOURCE_ID)) {
    map.addSource(NEATLINE_SOURCE_ID, { type: 'geojson', data: frameOf(bbox) })
  }
  if (map.getLayer(NEATLINE_LAYER_ID)) return
  map.addLayer({
    id: NEATLINE_LAYER_ID,
    type: 'line',
    source: NEATLINE_SOURCE_ID,
    layout: { 'line-cap': 'butt', 'line-join': 'miter' },
    paint: neatlinePaint(),
  })
}

/** Rule 1: every colour through `token()`. */
function neatlinePaint() {
  return {
    'line-color': token('--map-land-stroke'),
    'line-width': 1,
    'line-opacity': 0.5,
  }
}

/** Re-read the neatline's colour from the current theme. */
export function repaintNeatline(map: MapLibreMap): void {
  if (!map.getLayer(NEATLINE_LAYER_ID)) return
  map.setPaintProperty(NEATLINE_LAYER_ID, 'line-color', token('--map-land-stroke'))
}

/**
 * Draws a way into each plate inside this one.
 *
 * A dashed frame with a label anchored to its top edge, which is the inset
 * convention a paper atlas has used for a century: a box on the overview
 * marked "see plate 42". It reads as an invitation rather than as chrome, it
 * sits where the thing it offers actually is, and ten of them would be ten
 * boxes on a map rather than ten buttons in a bar.
 *
 * The label is a DOM marker, not a symbol layer, because the style carries no
 * `glyphs` url: this map draws no text at all, and adding a font stack to
 * serve two words would be a tile request per plate on every pan.
 */
export class Doorways {
  private readonly labels = new Map<string, Marker>()
  private drawn: readonly Doorway[] = []

  constructor(
    private readonly map: MapLibreMap,
    private readonly onEnter: (href: string) => void,
  ) {}

  /** Replaces whatever is drawn with `doorways`. Cheap to call repeatedly. */
  update(doorways: readonly Doorway[]): void {
    const wanted = new Set(doorways.map((doorway) => doorway.id))

    for (const doorway of this.drawn) {
      if (wanted.has(doorway.id)) continue
      this.labels.get(doorway.id)?.remove()
      this.labels.delete(doorway.id)
      if (this.map.getLayer(doorwayLineId(doorway.id))) {
        this.map.removeLayer(doorwayLineId(doorway.id))
      }
      if (this.map.getSource(doorwaySourceId(doorway.id))) {
        this.map.removeSource(doorwaySourceId(doorway.id))
      }
    }

    for (const doorway of doorways) {
      const sourceId = doorwaySourceId(doorway.id)
      if (!this.map.getSource(sourceId)) {
        this.map.addSource(sourceId, { type: 'geojson', data: frameOf(doorway.bbox) })
      }
      if (!this.map.getLayer(doorwayLineId(doorway.id))) {
        this.map.addLayer({
          id: doorwayLineId(doorway.id),
          type: 'line',
          source: sourceId,
          layout: { 'line-cap': 'butt', 'line-join': 'miter' },
          paint: framePaint(),
        })
      }

      let marker = this.labels.get(doorway.id)
      if (!marker) {
        const [west, , east, north] = doorway.bbox
        marker = new Marker({ element: this.createLabel(doorway), anchor: 'bottom' })
          .setLngLat([(west + east) / 2, north])
          .addTo(this.map)
        this.labels.set(doorway.id, marker)
      }
      // Rewritten every time rather than only on creation. The destination
      // carries the pack the reader is reading, and they can switch packs
      // without leaving the map, so a label written once points at the pack
      // they opened on for as long as they stay.
      this.writeLabel(marker.getElement() as HTMLAnchorElement, doorway)
    }

    this.drawn = doorways
  }

  /** Re-read every frame's colour from the current theme. Rule 1's other half. */
  repaint(): void {
    for (const doorway of this.drawn) {
      if (!this.map.getLayer(doorwayLineId(doorway.id))) continue
      this.map.setPaintProperty(doorwayLineId(doorway.id), 'line-color', token('--map-doorway'))
    }
  }

  /** The parts that can change without the doorway moving. */
  private writeLabel(element: HTMLAnchorElement, doorway: Doorway): void {
    element.href = doorway.href
    element.title = doorway.subtitle
    element.setAttribute('aria-label', `Explore ${doorway.title}: ${doorway.subtitle}`)
    const name = element.querySelector('.doorway__name')
    if (name) name.textContent = doorway.title
  }

  private createLabel(doorway: Doorway): HTMLAnchorElement {
    const element = document.createElement('a')
    element.className = 'doorway'
    element.dataset.doorway = doorway.id

    const name = document.createElement('span')
    name.className = 'doorway__name'

    const hint = document.createElement('span')
    hint.className = 'doorway__hint'
    // Says what happens, not what it is. "India" alone on a map is a label; a
    // reader has to be told the rectangle is a door before they will try it.
    hint.textContent = 'Look closer'

    element.append(name, hint)

    element.addEventListener('click', (event) => {
      // A real href, so it opens in a new tab on a modifier click and a
      // crawler can follow it, but an ordinary click is handed to the router
      // rather than reloading the document.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      // Read off the element rather than closed over, so a handler bound when
      // the label was created still sends the reader where the label says.
      this.onEnter(element.href)
    })

    return element
  }

  destroy(): void {
    for (const marker of this.labels.values()) marker.remove()
    this.labels.clear()
    this.drawn = []
  }
}
