import type { Entity } from './schemas'

/**
 * The span arithmetic that decides which pins are on the map at a given year.
 *
 * Carried over from the ported build's `src/data/entities.ts`, minus its
 * loader: fetching is now `Atlas`'s job (one artifact, one request), but the
 * offset and fade rules below are content semantics and survive the move
 * intact.
 */

/** Years over which a pin fades in and out at the edges of its span. */
export const FADE_YEARS = 15

export interface ActiveEntity extends Entity {
  /** First year the map shows them, after the pack's activeOffset. */
  from: number
  /** Last year the map shows them. */
  to: number
}

/**
 * Applies the pack's offset to an entity's raw span.
 *
 * Philosophy offsets by roughly adulthood: showing a thinker from the year of
 * birth would put a newborn Aristotle in Macedon for two decades before he had
 * an idea. Packs whose spans already mean "attested" set the offset to 0,
 * because there is no equivalent of growing up.
 */
export function withActiveSpan(entity: Entity, offset: number): ActiveEntity {
  const length = entity.end - entity.start
  const from = length > offset ? entity.start + offset : entity.start
  return { ...entity, from, to: entity.end }
}

export function isActive(entity: ActiveEntity, year: number): boolean {
  return year >= entity.from && year <= entity.to
}

/**
 * How strongly to draw a pin at a given year: full through the middle of a
 * span, tapering at both ends so scrubbing feels continuous rather than like
 * things snapping in and out of existence.
 */
export function presence(entity: ActiveEntity, year: number): number {
  const edge = Math.min(year - entity.from, entity.to - year)
  if (edge < 0) return 0
  return Math.min(1, edge / FADE_YEARS)
}

export function activeAt(entities: readonly ActiveEntity[], year: number): ActiveEntity[] {
  return entities.filter((entity) => isActive(entity, year))
}

/** How many years away from being on the map an entity is at a given year. */
function gapFrom(entity: ActiveEntity, year: number): number {
  if (year < entity.from) return entity.from - year
  if (year > entity.to) return year - entity.to
  return 0
}

/**
 * The entity nearest in time to an empty year.
 *
 * A sparse pack leaves stretches with nothing on the map. Rather than showing
 * a silent world and letting the user wonder whether it is broken, the empty
 * state can point at the closest thing there is.
 */
export function nearestInTime(
  entities: readonly ActiveEntity[],
  year: number,
): ActiveEntity | null {
  let best: ActiveEntity | null = null
  let bestGap = Infinity

  for (const entity of entities) {
    const gap = gapFrom(entity, year)
    if (gap < bestGap) {
      best = entity
      bestGap = gap
    }
  }

  return best
}

/** A year at which the entity is comfortably on the map, not at a fade edge. */
export function midSpan(entity: ActiveEntity): number {
  return Math.round((entity.from + entity.to) / 2)
}
