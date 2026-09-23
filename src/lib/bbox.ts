/** `[west, south, east, north]`, longitude first, as every artifact writes it. */
export type BBox = readonly [number, number, number, number]

/**
 * Whether a point stands on a plate.
 *
 * The one rule a regional atlas adds to the engine, and it is deliberately
 * this small: a region draws what is inside its own edges. On `world` the
 * edges are the world's, so every rule below is the identity there and nothing
 * about the world atlas changes.
 *
 * Inclusive on all four sides. A figure exactly on the line is on the plate;
 * excluding them would be a rounding decision dressed up as an editorial one.
 *
 * No antimeridian handling, and none is wanted: `regions.bbox` is a polygon
 * whose envelope this is, `scripts/build-tiles.ts` clips with the same
 * polygon, and a plate straddling 180° would already be cut in two there.
 * `scripts/import-layers.ts` refuses a leg that crosses it for the same
 * reason. If a plate ever needs to, all three change together.
 */
export function contains(bbox: BBox, lng: number, lat: number): boolean {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

/**
 * How far past its own edges a plate lets the camera travel, as a share of the
 * plate.
 *
 * One constant, read by two places that must agree: `MapCanvas` hands it to
 * MapLibre's `maxBounds`, and `validateView`'s rule 8 refuses a tour stop whose
 * camera sits outside it. If they disagreed, a stop would validate and then be
 * clamped somewhere else in the reader's browser, silently.
 */
export const CAMERA_PAD = 0.1

/** Web Mercator's own limit, past which there is no map to pan to. */
export const MERCATOR_LIMIT = 85.051129

/** Latitude to its position down the Web Mercator world, 0 at the top. */
function mercatorY(lat: number): number {
  const clamped = Math.min(MERCATOR_LIMIT, Math.max(-MERCATOR_LIMIT, lat))
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)) / (2 * Math.PI)
}

/** And back. */
function latFromY(y: number): number {
  const clamped = Math.min(1, Math.max(0, y))
  return ((2 * (Math.atan(Math.exp((0.5 - clamped) * 2 * Math.PI)) - Math.PI / 4)) * 180) / Math.PI
}

/** The viewport the map is drawn into, in CSS pixels. */
export interface Viewport {
  width: number
  height: number
}

/**
 * Whether a plate has edges at all.
 *
 * A plate reaching all the way round the world does not: `renderWorldCopies:
 * false` has already given the map its own, and there is no strip of world
 * left outside it. The two places that care are the camera bounds, which
 * MapLibre refuses to set for a global box, and the neatline, which would
 * otherwise draw a rule across the world map at the Mercator limit.
 */
export function hasEdges(bbox: BBox): boolean {
  return bbox[2] - bbox[0] < 360
}

/**
 * What the camera may travel over, or nothing when there is nothing to hold it
 * inside of.
 *
 * Three things at once, and each of them was learned the hard way.
 *
 * **It is never narrower than the plate needs.** MapLibre's `maxBounds` keeps
 * the *viewport* inside the bounds, not the centre of it, and it does that by
 * zooming in until the viewport fits. A plate as tall as it is wide, on a
 * screen half as tall as it is wide, therefore opens showing a quarter of
 * itself: the longitude constraint bites first and the latitude is simply cut
 * off. So the box is grown to the viewport's own aspect before the margin is
 * added, which is the smallest box that both holds the reader in and lets them
 * see the whole plate. This is why the viewport is a parameter: bounds that
 * ignore the shape of the screen cannot be right on every screen.
 *
 * **The margin.** A reader looking at Gujarat should be able to put it in the
 * middle of the screen, and bounds exactly on the coastline would pin the
 * coast to the edge of the viewport instead. A share of the plate rather than
 * a fixed number of degrees, so it means the same to a subcontinent and to a
 * county.
 *
 * **The undefined.** MapLibre throws when asked to bound the full 360°: handed
 * `[[-180, -85.05], [180, 85.05]]` it fails inside `constrainInternal` with
 * "Cannot read properties of null", during the first resize, before the map
 * exists, so the whole atlas renders as a blank error page rather than as a
 * map with a bad constraint. Measured against maplibre-gl 6.2 with
 * `renderWorldCopies: false`. It is also right on its own terms: a plate that
 * reaches all the way round has no left or right edge to be kept inside of,
 * and `renderWorldCopies: false` has already given the map its edges.
 */
export function cameraBounds(
  bbox: BBox, viewport: Viewport,
): [[number, number], [number, number]] | undefined {
  const [west, south, east, north] = bbox
  // The plate, as fractions of the whole Web Mercator world.
  const plateX = (east - west) / 360
  const plateY = mercatorY(south) - mercatorY(north)
  if (plateX <= 0 || plateY <= 0 || viewport.width <= 0 || viewport.height <= 0) return undefined

  // World pixels at the zoom that just fits the plate on this screen, and the
  // slice of world the viewport covers there.
  const fit = Math.min(viewport.width / plateX, viewport.height / plateY)
  const boxX = Math.max(plateX, viewport.width / fit) * (1 + 2 * CAMERA_PAD)
  const boxY = Math.max(plateY, viewport.height / fit) * (1 + 2 * CAMERA_PAD)

  if (boxX >= 1) return undefined

  const midX = (west + east) / 2
  const midY = (mercatorY(south) + mercatorY(north)) / 2

  return [
    [Math.max(-180, midX - (boxX * 360) / 2), latFromY(Math.min(1, midY + boxY / 2))],
    [Math.min(180, midX + (boxX * 360) / 2), latFromY(Math.max(0, midY - boxY / 2))],
  ]
}

/**
 * The plate's edges, widened by a fraction of its own size.
 *
 * What the camera may travel over, which is not quite what the plate draws: a
 * reader looking at Gujarat should be able to put it in the middle of the
 * screen, and bounds exactly on the coastline would pin the coast to the edge
 * of the viewport instead. A share of the plate rather than a fixed number of
 * degrees, so it means the same thing to a subcontinent and to the world.
 *
 * Latitude is clipped to the Web Mercator limit, past which there is no map to
 * pan to in any case.
 */
export function pad(bbox: BBox, fraction: number): [number, number, number, number] {
  const width = (bbox[2] - bbox[0]) * fraction
  const height = (bbox[3] - bbox[1]) * fraction
  return [
    Math.max(-180, bbox[0] - width),
    Math.max(-85.051129, bbox[1] - height),
    Math.min(180, bbox[2] + width),
    Math.min(85.051129, bbox[3] + height),
  ]
}
