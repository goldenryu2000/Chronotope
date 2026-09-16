import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { connectionConfig } from './connection'

/**
 * Docker locally, Neon in production, through the same driver. What differs
 * between the two is decided in ./connection.ts, not here.
 *
 * The test database is chosen only under Vitest, never by the mere presence of
 * DATABASE_URL_TEST. Next.js loads .env.local automatically and .env.local
 * defines both URLs, so an unconditional `DATABASE_URL_TEST ?? DATABASE_URL`
 * would point `next dev`/`next start` at the empty test database. Do not
 * "simplify" this back.
 *
 * Under Vitest the test URL is required outright, with no fallback to
 * DATABASE_URL. Tests truncate tables; falling back would let a missing
 * DATABASE_URL_TEST quietly delete the development database's content instead
 * of failing. Refusing to run is the only safe behaviour.
 */
let url: string | undefined
if (process.env.VITEST) {
  url = process.env.DATABASE_URL_TEST
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Tests delete rows and must never run against ' +
        'the development database — refusing to fall back to DATABASE_URL. ' +
        'Copy .env.example to .env.local.',
    )
  }
} else {
  url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
}

const { url: connectionUrl, options } = connectionConfig(url, process.env)
export const db = drizzle(postgres(connectionUrl, options), { schema })
