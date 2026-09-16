import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import {
  boundaries, entities, entityTraditions, packs, regions, traditions,
} from '../db/schema'
import { PackSchema, RegionSchema } from '../data/schemas'
import { importPack, importWorldRegion, LEGACY_CONTENT_DIR } from '../../scripts/import-legacy'
import { artifactKey, hashArtifact } from './hash'
import { renderPack } from './renderPack'
import { renderRegion } from './renderRegion'

let packId: string

/**
 * Vitest runs this repo's `*.test.ts` files serially against one shared
 * Postgres (see vitest.config.ts's `fileParallelism: false` note), and file
 * discovery order does not put scripts/import-legacy.test.ts — the file that
 * seeds 'world' + 'philosophy' — before this one. Rather than depend on
 * another file's beforeAll running first (fragile, and it doesn't), seed the
 * same fixture here directly, exactly as scripts/import-legacy.test.ts does.
 * This is what every other db-backed test file in this repo already does.
 */
async function seedWorldAndPhilosophy() {
  await db.delete(regions)
  await db.delete(packs)
  await importWorldRegion()
  await importPack(`${LEGACY_CONTENT_DIR}/philosophy`, 'world')
}

describe('renderPack', () => {
  beforeAll(async () => {
    await seedWorldAndPhilosophy()
    const [row] = await db.select().from(packs).where(eq(packs.slug, 'philosophy'))
    packId = row.id
  })

  it('produces an artifact that satisfies the published contract', async () => {
    const artifact = await renderPack(packId)
    expect(() => PackSchema.parse(artifact)).not.toThrow()
  })

  it('converts end-exclusive ranges back to inclusive years', async () => {
    const artifact = await renderPack(packId)
    const laozi = artifact.entities.find((e) => e.id === 'laozi')!
    expect(laozi.start).toBe(-604)
    expect(laozi.end).toBe(-500)
  })

  it('keys eraOverrides by region slug', async () => {
    const artifact = await renderPack(packId)
    expect(Object.keys(artifact.eraOverrides)).toContain('world')
  })

  it('renders identically across repeated calls, so the hash is stable', async () => {
    // Proof, not assertion-by-faith: render the same pack several times in
    // one process and hash each result. If either of renderPack's two
    // unordered queries (traditions, entity_traditions links) ever fed row
    // order straight into the artifact again, this would be flaky rather
    // than reliably green — Postgres does not promise row order without
    // ORDER BY, so a real regression would show up as occasional, not
    // guaranteed, mismatches. See the dedicated 'renderPack determinism'
    // suite below for a guard that fails deterministically, not by chance.
    const hashes = await Promise.all(
      Array.from({ length: 5 }, () => renderPack(packId).then(hashArtifact)),
    )
    expect(new Set(hashes).size).toBe(1)
  })
})

describe('renderRegion', () => {
  let worldRegionId: string

  beforeAll(async () => {
    await seedWorldAndPhilosophy()
    const [row] = await db.select().from(regions).where(eq(regions.slug, 'world'))
    worldRegionId = row.id

    // This file owns `boundaries` for the coverage tests below, the same way
    // `seedWorldAndPhilosophy` owns `regions`. Emptying it is safe and cheap:
    // every suite that needs boundary rows imports them when the table is
    // empty rather than assuming another file ran first.
    await db.delete(boundaries)
  })

  afterAll(async () => {
    await db.delete(boundaries)
  })

  it('produces the region default artifact, not any pack override', async () => {
    const artifact = await renderRegion(worldRegionId)
    expect(() => RegionSchema.parse(artifact)).not.toThrow()
    expect(artifact.bbox).toEqual([-180, -85, 180, 85])
    expect(artifact.range).toEqual({ start: -4000, end: 2026 })
    expect(artifact.eras).toHaveLength(11)
  })

  it('reports no border coverage when no boundaries have been imported', async () => {
    // `seedWorldAndPhilosophy` seeds the region and the pack, not boundaries.
    // Absent rather than a guessed range: the client clamps the year to this,
    // and clamping to a range nobody measured would draw the wrong century.
    const artifact = await renderRegion(worldRegionId)
    expect(artifact.borderYears).toBeUndefined()
  })

  it('reports the years its boundaries actually cover', async () => {
    // The timeline runs to 2026 and the corpus stops at 2010, so the region
    // has to say where its map ends or the client cannot tell an unmapped
    // year from a broken one. `last` is inclusive; `valid` is not.
    const square = 'SRID=4326;MULTIPOLYGON(((0 0,1 0,1 1,0 1,0 0)))'
    await db.insert(boundaries).values([
      { name: 'Testland', valid: [-800, -700], geom: square, source: 'test' },
      { name: 'Testland', valid: [-700, -600], geom: square, source: 'test' },
    ])

    const artifact = await renderRegion(worldRegionId)
    expect(artifact.borderYears).toEqual({ first: -800, last: -601 })
  })
})

describe('renderPack determinism', () => {
  // A real guard for the ordering bug, not a hope that Postgres happens to
  // misbehave: `traditions` and `entity_traditions` rows are inserted here
  // in the *reverse* of their slugs' alphabetical order. Neither renderPack
  // query for these tables carries an ORDER BY matching that reversal
  // (traditions is explicitly ordered by slug; entity_traditions has no
  // ORDER BY at all and is sorted in JS instead) — but a fresh, tiny,
  // just-inserted table is exactly the case where Postgres's unordered scan
  // tends to return rows in insertion order, so if renderPack ever stopped
  // sorting, this fixture is built to make that show up as a wrong-order
  // assertion every time, not intermittently.
  let fixturePackId: string
  const zetaSlug = 'zeta-tradition'
  const alphaSlug = 'alpha-tradition'

  beforeAll(async () => {
    const [pack] = await db.insert(packs).values({
      slug: 'ordering-fixture',
      title: 'Ordering Fixture',
      subtitle: 'For determinism tests only',
      spanLabel: 'test span',
      range: [-100, 1],
      startYear: -100,
    }).returning()
    fixturePackId = pack.id

    // Inserted zeta-before-alpha on purpose: alphabetical is the opposite of
    // insertion order here.
    const [zeta] = await db.insert(traditions).values({
      packId: fixturePackId, slug: zetaSlug, label: 'Zeta', regionLabel: 'Nowhere',
    }).returning()
    const [alpha] = await db.insert(traditions).values({
      packId: fixturePackId, slug: alphaSlug, label: 'Alpha', regionLabel: 'Nowhere',
    }).returning()

    const [entity] = await db.insert(entities).values({
      packId: fixturePackId,
      slug: 'test-entity',
      name: 'Test Entity',
      span: [-100, -50],
      point: 'SRID=4326;POINT(10 20)',
      place: 'Nowhere',
      tier: 'core',
      blurb: 'A fixture entity used only to test deterministic ordering.',
      wikipedia: 'https://en.wikipedia.org/wiki/Test',
      wikidata: 'Q1',
    }).returning()

    // Link rows inserted zeta-before-alpha too, same reasoning.
    await db.insert(entityTraditions).values([
      { entityId: entity.id, traditionId: zeta.id },
      { entityId: entity.id, traditionId: alpha.id },
    ])
  })

  afterAll(async () => {
    await db.delete(packs).where(eq(packs.slug, 'ordering-fixture'))
  })

  it('orders top-level traditions by slug, not by insertion order', async () => {
    const artifact = await renderPack(fixturePackId)
    expect(artifact.traditions.map((t) => t.id)).toEqual([alphaSlug, zetaSlug])
  })

  it("orders an entity's traditions by slug, not by link insertion order", async () => {
    const artifact = await renderPack(fixturePackId)
    const entity = artifact.entities.find((e) => e.id === 'test-entity')!
    expect(entity.traditions).toEqual([alphaSlug, zetaSlug])
  })

  it('hashes identically across repeated renders of this fixture too', async () => {
    const hashes = await Promise.all(
      Array.from({ length: 5 }, () => renderPack(fixturePackId).then(hashArtifact)),
    )
    expect(new Set(hashes).size).toBe(1)
  })
})

describe('hashArtifact', () => {
  it('is stable across key order', () => {
    expect(hashArtifact({ a: 1, b: 2 })).toBe(hashArtifact({ b: 2, a: 1 }))
  })
  it('changes when content changes', () => {
    expect(hashArtifact({ a: 1 })).not.toBe(hashArtifact({ a: 2 }))
  })
  it('builds an immutable key', () => {
    expect(artifactKey('packs', 'philosophy', 'abc123')).toBe('packs/philosophy/abc123.json')
  })
})
