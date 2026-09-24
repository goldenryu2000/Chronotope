import { isSlug } from '../data/schemas'

/**
 * Where an atlas address says to stand: `?year=-350&entity=plato`.
 *
 * Only a year and a figure. The pack and the region are the path, and the
 * camera is left to the plate: a link names a moment and who to open, not a
 * zoom that was only ever right on the screen it was copied from.
 */
export interface AtlasLink {
  year?: number
  entity?: string
}

/** A plain signed year, as the store keeps it. There is no year 0. */
const YEAR = /^-?\d{1,6}$/

/**
 * Reads the address, dropping whatever is not a year or a slug.
 *
 * A bad value is ignored rather than refused: a mistyped year still opens the
 * atlas, on its own opening year. Clamping into the pack's range is left to the
 * caller, which is the only one that knows it.
 */
export function readAtlasLink(search: string): AtlasLink {
  const params = new URLSearchParams(search)
  const link: AtlasLink = {}

  const year = params.get('year')
  if (year !== null && YEAR.test(year) && Number(year) !== 0) link.year = Number(year)

  const entity = params.get('entity')
  if (entity !== null && isSlug(entity)) link.entity = entity

  return link
}

/** The address of an atlas standing at a year, with someone open. */
export function atlasHref(region: string, pack: string, link: AtlasLink = {}): string {
  return `/${region}/${pack}${atlasQuery(link)}`
}

/** Just the query, `?year=…&entity=…`, or nothing when there is nothing to say. */
export function atlasQuery({ year, entity }: AtlasLink): string {
  const params = new URLSearchParams()
  if (year !== undefined && Number.isInteger(year)) params.set('year', String(year))
  if (entity) params.set('entity', entity)
  const query = params.toString()
  return query ? `?${query}` : ''
}
