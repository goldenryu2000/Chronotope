import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../src/db/client'
import { entities, eraSets, eras, packs, regions } from '../src/db/schema'
import { importPack, importWorldRegion, LEGACY_CONTENT_DIR } from './import-legacy'

describe('legacy import', () => {
  beforeAll(async () => {
    await db.delete(regions)
    await db.delete(packs)
    await importWorldRegion()
    await importPack(`${LEGACY_CONTENT_DIR}/philosophy`, 'world')
  })

  it('imports every philosophy entity', async () => {
    const [pack] = await db.select().from(packs).where(eq(packs.slug, 'philosophy'))
    const rows = await db.select().from(entities).where(eq(entities.packId, pack.id))
    expect(rows.length).toBe(81)
  })

  it('stores spans as ranges, exclusive at the end', async () => {
    const [laozi] = await db.select().from(entities).where(eq(entities.slug, 'laozi'))
    expect(laozi.span).toEqual([-604, -499])
  })

  it('attaches the pack eras as an override on world, not as the region default', async () => {
    const [pack] = await db.select().from(packs).where(eq(packs.slug, 'philosophy'))
    const [override] = await db.select().from(eraSets).where(eq(eraSets.packId, pack.id))
    expect(override).toBeDefined()
    const rows = await db.select().from(eras).where(eq(eras.eraSetId, override.id))
    expect(rows.length).toBe(11)
  })

  it('leaves the world region with a default era set of its own', async () => {
    const [world] = await db.select().from(regions).where(eq(regions.slug, 'world'))
    const sets = await db.select().from(eraSets).where(eq(eraSets.regionId, world.id))
    expect(sets.some((s) => s.packId === null)).toBe(true)
  })

  it('does not transpose latitude and longitude', async () => {
    // Source: lat 30.423, lng 112.173. EWKT POINT is (lng lat) — if this ever
    // reads back as POINT(30.423 112.173) the two have been swapped.
    const [row] = await db
      .select({ point: sql<string>`ST_AsText(${entities.point})` })
      .from(entities)
      .where(eq(entities.slug, 'laozi'))
    expect(row.point).toBe('POINT(112.173 30.423)')
  })

  it('narrows the pack range to the legacy manifest range, end-exclusive', async () => {
    // philosophy/manifest.json declares range { start: -800, end: 2026 }.
    const [pack] = await db.select().from(packs).where(eq(packs.slug, 'philosophy'))
    expect(pack.range).toEqual([-800, 2027])
  })

  it('throws naming the entity and the slug when an entity references an undeclared tradition, and commits nothing', async () => {
    // Built here, not under LEGACY_CONTENT_DIR — that tree is a
    // read-only reference build and must never be written to.
    const dir = mkdtempSync(join(tmpdir(), 'chronotope-fixture-'))
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
      id: 'fixture-pack',
      title: 'Fixture Pack',
      subtitle: 'For tests only',
      spanLabel: 'test span',
      range: { start: -100, end: -50 },
      startYear: -100,
      traditions: [],
      eras: [],
    }))
    writeFileSync(join(dir, 'entities.json'), JSON.stringify([{
      id: 'fixture-entity',
      name: 'Fixture Entity',
      start: -100,
      end: -50,
      lat: 10,
      lng: 20,
      place: 'Nowhere',
      traditions: ['undeclared-tradition'],
      tier: 'core',
      blurb: 'A fixture entity used only to test the unknown-tradition guard.',
      wikipedia: 'https://en.wikipedia.org/wiki/Fixture',
      wikidata: 'Q1',
    }]))

    let caught: unknown
    try {
      await importPack(dir, 'world')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('fixture-entity')
    expect((caught as Error).message).toContain('undeclared-tradition')

    // The transaction must have rolled back: no orphaned pack row.
    const rows = await db.select().from(packs).where(eq(packs.slug, 'fixture-pack'))
    expect(rows.length).toBe(0)
  })
})
