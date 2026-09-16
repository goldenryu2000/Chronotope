import { config } from 'dotenv'

/**
 * Next.js and Vitest load .env.local on their own (see vitest.setup.ts);
 * a plain `tsx` invocation does not — same reason drizzle.config.ts loads it
 * for drizzle-kit. This has to be its own module, imported before `db`, and
 * not just a function called from within import-legacy.ts: ES module
 * evaluation order means every static import a module holds is evaluated
 * before that module's own top-level statements run, so a same-file call
 * placed textually above `import { db } from '../src/db/client'` would still
 * run after db/client.ts has already thrown on a missing DATABASE_URL.
 * Importing this file first, as its own module, is what actually sequences
 * the env load before db/client.ts evaluates.
 */
/**
 * Which file to load. `ENV_FILE=.env.deploy` points every script at production
 * (Neon, R2) without editing `.env.local`, and without `next dev` ever seeing
 * those credentials, because Next only reads `.env*` files by their fixed names.
 */
export function envFilePath(env: Record<string, string | undefined>): string {
  return env.ENV_FILE ?? '.env.local'
}

config({ path: envFilePath(process.env), quiet: true })
