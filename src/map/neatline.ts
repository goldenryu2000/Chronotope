import type { Map as MapLibreMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { hasEdges, type BBox } from '../lib/bbox'
import { token } from '../theme/themes'

export const NEATLINE_SOURCE_ID = 'plate-edge-source'
export const NEATLINE_LAYER_ID = 'plate-edge'

/** A bbox as a closed ring. */
export function ringOf(bbox: BBox): FeatureCollection {
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

/** Rule 1: every colour through `token()`. */
function neatlinePaint() {
  return {
    'line-color': token('--map-land-stroke'),
    'line-width': 1,
    'line-opacity': 0.5,
  }
}

/**
 * Draws the plate's own edge, where it has one.
 *
 * A regional archive is cut to its bbox, so the land simply stops on a
 * straight line and the parchment meets the sea at a right angle. Unmarked
 * that reads as a rendering fault; a thin rule along it is the neatline a
 * printed plate has always had, and it turns the same pixels into a deliberate
 * edge.
 *
 * This is the *only* rectangle the map draws, and it is drawn on the plate it
 * belongs to. Marking a plate on its parent's map with a rectangle was the
 * first design and it was wrong twice over: the bbox is a clipping artifact
 * rather than anything true about the place, and every line on this map except
 * this one is a historical border, so a second kind of rectangle competed with
 * the data for the reader's attention at every year and every zoom. What
 * offers a plate now is `invitation.ts`, which draws no geometry at all.
 *
 * Nothing is drawn for a plate that reaches all the way round: the world map's
 * edge is the map's edge, and a rule along the Mercator limit would be a line
 * across the top of the world that means nothing.
 */
export function addNeatline(map: MapLibreMap, bbox: BBox): void {
  if (!hasEdges(bbox)) return
  if (!map.getSource(NEATLINE_SOURCE_ID)) {
    map.addSource(NEATLINE_SOURCE_ID, { type: 'geojson', data: ringOf(bbox) })
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

/** Re-read the neatline's colour from the current theme. */
export function repaintNeatline(map: MapLibreMap): void {
  if (!map.getLayer(NEATLINE_LAYER_ID)) return
  map.setPaintProperty(NEATLINE_LAYER_ID, 'line-color', token('--map-land-stroke'))
}
