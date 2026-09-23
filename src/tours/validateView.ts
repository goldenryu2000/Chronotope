import { presence, withActiveSpan } from '../data/entitySpan'
import type { AtlasView, Pack, Region, Tour } from '../data/schemas'
import { CAMERA_PAD, contains, pad } from '../lib/bbox'
import { resolveRange } from '../timeline/resolveEras'

/**
 * How far a stop's camera may sit from the pin it is narrating, in degrees.
 *
 * Nothing structural stops a stop from flying to Angkor while selecting someone
 * in the Aegean, and the result is narration over an empty map. The ported
 * build had no check and shipped four broken stops out of twenty-eight.
 */
export const CAMERA_DEGREES = 8

/** Below this, a pin renders as a ghost: on the map, but visibly fading. */
export const PRESENCE_WARN = 0.7


export interface ViewProblem {
  /** Which numbered rule in the design this violates. */
  rule: number
  level: 'error' | 'warning'
  message: string
}

export interface LayerBounds {
  start: number
  end: number
  /** `[west, south, east, north]`: longitude first, as every camera centre is. */
  bbox: [number, number, number, number]
}

export interface ViewContext {
  region: Region
  pack: Pack
  /** Published layers by slug: the years each draws, and where it draws them. */
  layers: ReadonlyMap<string, LayerBounds>
}

/** Longitude difference the short way round, so a pair across the antimeridian is near. */
function longitudeGap(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

export function validateView(view: AtlasView, ctx: ViewContext): ViewProblem[] {
  const problems: ViewProblem[] = []
  const entity = view.entityId
    ? ctx.pack.entities.find((candidate) => candidate.id === view.entityId)
    : null

  // Rule 1. Redundant against the foreign key today, and not redundant once a
  // tour can be authored as an artifact from outside the database.
  if (view.entityId && !entity) {
    problems.push({
      rule: 1,
      level: 'error',
      message: `no entity "${view.entityId}" in pack "${ctx.pack.id}"`,
    })
  }

  if (entity) {
    // Rule 2. `presence` is what the marker's opacity is set from, so this is
    // the same number the reader sees, not a proxy for it.
    const active = withActiveSpan(entity, ctx.pack.activeOffset)
    const strength = presence(active, view.year)
    if (strength <= 0) {
      problems.push({
        rule: 2,
        level: 'error',
        message: `${entity.id} is not on the map in ${view.year} (shown ${active.from} to ${active.to})`,
      })
    } else if (strength < PRESENCE_WARN) {
      problems.push({
        rule: 2,
        level: 'warning',
        message: `${entity.id} renders at ${strength.toFixed(2)} in ${view.year}, near a fade edge`,
      })
    }

    /*
     * Rule 8. The rule regional atlases make necessary.
     *
     * A plate draws the figures who stand on it (`Atlas` narrows the pack to
     * the region's bbox), so a stop on India selecting someone in Athens would
     * read its narration over a map with no pin in it. Before there was a
     * second region this could not happen: the only plate was the world, and
     * every figure is on it.
     *
     * Checked against the same predicate the atlas filters with, not a looser
     * one, for the reason rule 5 is checked against `layersOnRegion`: a stop is
     * honest if the reader's browser can render it, and a rule that allowed
     * more than the browser shows is not a rule.
     */
    if (!contains(ctx.region.bbox, entity.lng, entity.lat)) {
      problems.push({
        rule: 8,
        level: 'error',
        message:
          `${entity.id} stands at ${entity.lng.toFixed(1)}, ${entity.lat.toFixed(1)}, `
          + `outside ${ctx.region.id} (${ctx.region.bbox.join(', ')}), so this plate `
          + 'draws no pin for them',
      })
    }

    // Rule 3.
    if (view.camera) {
      const [lng, lat] = view.camera.center
      const gap = Math.hypot(longitudeGap(lng, entity.lng), lat - entity.lat)
      if (gap > CAMERA_DEGREES) {
        problems.push({
          rule: 3,
          level: 'error',
          message: `camera sits ${gap.toFixed(1)}° from ${entity.id}, past the ${CAMERA_DEGREES}° limit`,
        })
      }
    }
  }

  /*
   * Rule 8's other half: the camera itself.
   *
   * `MapCanvas` constrains the camera to the region's bbox, so a stop framing
   * something outside it is not merely off-topic, it is unreachable: MapLibre
   * clamps the move and the reader lands somewhere the author did not choose,
   * silently. Padded the same tenth of the plate the camera bounds are padded
   * by, so the two agree about what the camera can actually do.
   */
  if (view.camera) {
    const [lng, lat] = view.camera.center
    const reachable = pad(ctx.region.bbox, CAMERA_PAD)
    if (!contains(reachable, lng, lat)) {
      problems.push({
        rule: 8,
        level: 'error',
        message:
          `camera at ${lng.toFixed(1)}, ${lat.toFixed(1)} is outside what `
          + `${ctx.region.id} lets the camera reach (${reachable.map((n) => n.toFixed(1)).join(', ')})`,
      })
    }
  }

  // Rule 4. The region sets the outer bound and the pack narrows within it, so
  // a year legal in one can be unreachable in the pair.
  const range = resolveRange(ctx.region, ctx.pack)
  if (view.year < range.start || view.year > range.end) {
    problems.push({
      rule: 4,
      level: 'error',
      message: `${view.year} is outside ${range.start} to ${range.end} for ${ctx.region.id}/${ctx.pack.id}`,
    })
  }

  // Rule 5. Live since `publishTour` started passing the published layers; it
  // was inert before that, because no stop named a layer, so this loop never
  // ran over anything.
  for (const slug of view.layers) {
    const valid = ctx.layers.get(slug)
    if (!valid) {
      problems.push({ rule: 5, level: 'error', message: `no published layer "${slug}"` })
    } else if (view.year < valid.start || view.year > valid.end) {
      problems.push({
        rule: 5,
        level: 'error',
        message: `layer "${slug}" does not draw in ${view.year} (${valid.start} to ${valid.end})`,
      })
    }
  }

  /*
   * Rule 7. The rule layers make necessary.
   *
   * Rule 3 keeps a stop's camera near the pin it is narrating, and it is
   * skipped entirely when nobody is selected, which before layers meant a stop
   * shape nobody could author usefully. A layer-led stop is exactly that
   * shape: prose over a route, nobody selected, and a camera nothing was
   * checking. So a stop with no entity must put its camera over the layers it
   * lights.
   *
   * A stop with neither an entity nor a layer is refused outright. It is a
   * view of nothing, and nothing in the reader's browser would tell it apart
   * from a bug.
   */
  if (!view.entityId) {
    if (view.layers.length === 0) {
      problems.push({
        rule: 7,
        level: 'error',
        message: 'stop selects neither an entity nor a layer, so it narrates an empty map',
      })
    } else if (view.camera) {
      const known = view.layers
        .map((slug) => ctx.layers.get(slug))
        .filter((bounds): bounds is LayerBounds => bounds !== undefined)

      // An unknown slug is rule 5's error, already reported; adding a second
      // one here would name the same mistake twice.
      if (known.length > 0) {
        const west = Math.min(...known.map((b) => b.bbox[0])) - CAMERA_DEGREES
        const south = Math.min(...known.map((b) => b.bbox[1])) - CAMERA_DEGREES
        const east = Math.max(...known.map((b) => b.bbox[2])) + CAMERA_DEGREES
        const north = Math.max(...known.map((b) => b.bbox[3])) + CAMERA_DEGREES
        const [lng, lat] = view.camera.center

        if (lng < west || lng > east || lat < south || lat > north) {
          problems.push({
            rule: 7,
            level: 'error',
            message:
              `camera at ${lng.toFixed(1)}, ${lat.toFixed(1)} is outside `
              + `${view.layers.join(', ')} (${west.toFixed(1)} to ${east.toFixed(1)}, `
              + `${south.toFixed(1)} to ${north.toFixed(1)}, with ${CAMERA_DEGREES}° of slack)`,
          })
        }
      }
    }
  }

  return problems
}

export function validateTour(
  tour: Tour,
  ctx: {
    region: Region
    packs: ReadonlyMap<string, Pack>
    layers: ReadonlyMap<string, LayerBounds>
  },
): ViewProblem[] {
  return tour.stops.flatMap((stop, index) => {
    const pack = ctx.packs.get(stop.pack)
    const where = `stop ${index + 1} of "${tour.id}"`
    if (!pack) {
      return [{ rule: 1, level: 'error' as const, message: `${where}: pack "${stop.pack}" is not published` }]
    }
    return validateView(stop, { region: ctx.region, pack, layers: ctx.layers })
      .map((problem) => ({ ...problem, message: `${where}: ${problem.message}` }))
  })
}
