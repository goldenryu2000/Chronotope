import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from './schema'

/**
 * `schema.ts` and the committed migrations describe the same database.
 *
 * They are two sources for one fact, and nothing else in the suite compares
 * them: every db-backed test runs against a database built from the
 * migrations, so a change to `schema.ts` that nobody generated a migration for
 * typechecks, lints and passes, and then surfaces as an unrelated diff in
 * whoever next runs `drizzle-kit generate`. The `restrict` on
 * `tour_stop_layers` was falsified during review by altering the constraint in
 * the database directly, which only proved anything because the two sources
 * happened to agree; this is what says they do.
 *
 * No database involved. drizzle-kit computes what `generate` would write, from
 * the schema module and the latest snapshot, and that must be nothing.
 */
describe('migrations', () => {
  it('are up to date with schema.ts', async () => {
    const meta = join(process.cwd(), 'drizzle', 'meta')
    const latest = readdirSync(meta).filter((name) => name.endsWith('_snapshot.json')).sort().at(-1)
    expect(latest).toBeDefined()

    const snapshot = JSON.parse(readFileSync(join(meta, latest!), 'utf8'))
    const current = generateDrizzleJson(schema as Record<string, unknown>, snapshot.id)
    const pending = await generateMigration(snapshot, current)

    // Named, so a failure says which snapshot it compared against and prints
    // the statements `drizzle-kit generate` would have written.
    expect({ latest, pending }).toEqual({ latest, pending: [] })
  })
})
