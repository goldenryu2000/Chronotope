import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

export interface Storage {
  put(key: string, body: string, contentType: string): Promise<void>
}

/** Tests only. Never touches the disk or the network. */
export function memoryStorage() {
  const objects = new Map<string, string>()
  return {
    objects,
    async put(key: string, body: string) { objects.set(key, body) },
  }
}

/**
 * Local development. Writes under `public/artifacts/`, which Next.js serves
 * statically, so `NEXT_PUBLIC_ARTIFACT_BASE_URL=/artifacts` is all the wiring
 * the read path needs. Artifacts are content-hashed, so a stale file is never
 * served under a key that has changed.
 */
export function fileStorage(root = join(process.cwd(), 'public', 'artifacts')): Storage {
  return {
    async put(key, body) {
      const path = join(root, key)
      // `key` is caller-supplied. Today it always comes from `artifactKey`
      // and is safe, but this function writes to the filesystem, so refuse
      // anything that would resolve outside `root` (e.g. a key containing
      // `..`) rather than trust every future caller to sanitise it first.
      const rel = relative(root, path)
      if (rel.startsWith('..') || rel === '') {
        throw new Error(`refusing to write outside storage root: ${key}`)
      }
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, body, 'utf8')
    },
  }
}

// `Storage` is the whole seam. The R2 implementation lives in ./r2.ts, and
// ./selectStorage.ts picks between it and fileStorage.
