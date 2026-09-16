import { isLocalDatabase } from '../db/connection'
import { r2Client, r2ConfigFromEnv, r2Storage } from './r2'
import { fileStorage, type Storage } from './storage'

/**
 * Where `publish-all` writes, chosen by `STORAGE`.
 *
 * The database and the storage have to be the same environment. Publishing
 * Neon to local disk records version pointers to objects the site can never
 * fetch, and every atlas 404s. Publishing Docker into the bucket fills
 * production with artifacts nothing points at. Both are refused, because both
 * run without error and only show up later as a broken page.
 */
export function storageFromEnv(env: Record<string, string | undefined>): Storage {
  const kind = env.STORAGE ?? 'file'
  const local = env.DATABASE_URL ? isLocalDatabase(env.DATABASE_URL) : true

  if (kind === 'file') {
    if (!local) {
      throw new Error('DATABASE_URL is not a local database. Publish it with STORAGE=r2, not to local disk.')
    }
    return fileStorage()
  }
  if (kind === 'r2') {
    if (local) {
      throw new Error('STORAGE=r2 with a local database would publish development content to production.')
    }
    const config = r2ConfigFromEnv(env)
    return r2Storage(r2Client(config), config.bucket)
  }
  throw new Error(`STORAGE must be "file" or "r2", not "${kind}"`)
}
