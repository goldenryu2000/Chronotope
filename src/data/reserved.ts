/**
 * Route segments under `/[region]/` that are not pack slugs.
 *
 * The database holds the same list as a check constraint on `packs.slug`; this
 * is so an importer can say which slug is refused and why, before Postgres
 * says it less helpfully.
 */
export const RESERVED_SLUGS = ['tours'] as const

export function isReservedSlug(slug: string): boolean {
  return (RESERVED_SLUGS as readonly string[]).includes(slug)
}
