import { config } from 'dotenv'

/**
 * Next.js loads .env.local by itself; Vitest does not. Without this the db
 * tests would see no DATABASE_URL_TEST and src/db/client.ts would throw on
 * import. Runs per worker, before the test file is imported, because the
 * client reads the URL at module scope.
 */
config({ path: '.env.local', quiet: true })
