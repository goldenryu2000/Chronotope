import { createHash } from 'node:crypto'

/** Stable stringify: sorted keys, so an artifact's hash tracks content, not key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
  return `{${entries.join(',')}}`
}

export function hashArtifact(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16)
}

export function artifactKey(
  kind: 'packs' | 'regions' | 'tours' | 'layers',
  slug: string,
  hash: string,
): string {
  return `${kind}/${slug}/${hash}.json`
}
