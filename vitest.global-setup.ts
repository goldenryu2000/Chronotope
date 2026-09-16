import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

config({ path: '.env.local', quiet: true })

/**
 * Bring the test database up to the current schema before any test file runs.
 *
 * `docker compose up -d` creates chronotope_test from docker/initdb, but an
 * empty database is not a usable one. Migrating here — rather than asking a
 * human to run drizzle-kit against DATABASE_URL_TEST — is what makes
 * `docker compose down -v && docker compose up -d && npm test` work cold.
 */
export default async function setup() {
  // No fallback to DATABASE_URL on purpose: see the note in src/db/client.ts.
  // Migrating — and then testing against — the development database because a
  // variable was missing is exactly the accident the second database exists to
  // prevent.
  const url = process.env.DATABASE_URL_TEST
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Tests delete rows and must never run against ' +
        'the development database. Copy .env.example to .env.local.',
    )
  }

  // `onnotice` silences the "schema drizzle already exists, skipping" notices
  // that a re-run of an applied migration emits on every test invocation.
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(sql), { migrationsFolder: './drizzle' })
  } finally {
    await sql.end()
  }
}
