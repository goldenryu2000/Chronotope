import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'
import { migrationCredentials } from './src/db/connection'

// Next.js reads .env.local on its own; drizzle-kit does not, so load it here.
// ENV_FILE follows the same rule as scripts/load-env.ts, so
// `ENV_FILE=.env.deploy npx drizzle-kit migrate` migrates production.
config({ path: process.env.ENV_FILE ?? '.env.local', quiet: true })

/**
 * A warning for anyone regenerating from scratch: `drizzle-kit generate` never
 * emits `CREATE EXTENSION`. The line at the top of 0000_moaning_tattoo.sql was
 * added by hand. PostGIS is now installed by docker/initdb instead, so
 * deleting drizzle/ and regenerating is safe against a compose-provisioned
 * database — but any other target (a managed Postgres, CI) must have the
 * extension installed before the first migration runs.
 */

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Not `{ url }`: see migrationCredentials for what that does against Neon.
  dbCredentials: migrationCredentials(process.env.DATABASE_URL!),
})
