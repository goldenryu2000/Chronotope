/**
 * Where the browser fetches a stored object from.
 *
 * No base means this origin, which is how `next dev` serves `public/`. In
 * production the base is the R2 custom domain. Keys are the same in both
 * places, so the database never records which environment it was published in.
 */
export function assetUrl(base: string | undefined, key: string): string {
  const origin = (base ?? '').replace(/\/+$/, '')
  return `${origin}/${key.replace(/^\/+/, '')}`
}
