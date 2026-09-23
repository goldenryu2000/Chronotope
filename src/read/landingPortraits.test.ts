import { eq, sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../db/client'
import { entities, packs, regions } from '../db/schema'
import { seedRegionsAndPacks } from '../db/testSeed'
import { publishRegion } from '../publish/publishPack'
import { memoryStorage } from '../publish/storage'
import { seedTours } from '../../scripts/seed-tours'
import { freePortraits, tourCovers } from './landingPortraits'
import { publishAllTours } from './testSupport'

beforeAll(async () => {
  await seedRegionsAndPacks()
  const [world] = await db.select().from(regions).where(eq(regions.slug, 'world'))
  await publishRegion(world.id, memoryStorage())
  await seedTours()
  await publishAllTours()
})

describe('freePortraits', () => {
  it('lists only images that need no credit to show', async () => {
    const found = await freePortraits('world')
    expect(found.length).toBeGreaterThan(0)

    const [counted] = await db.execute(sql`
      select count(*)::int as n from ${entities}
      where ${entities.image}->>'licence' in ('Public domain', 'CC0')
    `) as unknown as Array<{ n: number }>
    expect(found).toHaveLength(counted.n)

    const slugs = new Set(found.map((portrait) => `${portrait.pack}/${portrait.slug}`))
    const credited = await db.execute(sql`
      select ${packs.slug} as pack, ${entities.slug} as slug from ${entities}
      join ${packs} on ${packs.id} = ${entities.packId}
      where ${entities.image} is not null
        and not (${entities.image}->>'licence' in ('Public domain', 'CC0'))
    `) as unknown as Array<{ pack: string; slug: string }>
    expect(credited.length).toBeGreaterThan(0)
    for (const row of credited) expect(slugs.has(`${row.pack}/${row.slug}`)).toBe(false)
  })

  it('carries what a pin and a card need', async () => {
    const found = await freePortraits('world')
    const socrates = found.find((portrait) => portrait.slug === 'socrates')
    expect(socrates).toMatchObject({
      pack: 'philosophy',
      name: 'Socrates',
      start: -470,
      end: -399,
      src: '/images/philosophy/socrates.jpg',
    })
    expect(socrates!.lng).toBeCloseTo(23.7, 0)
    expect(socrates!.lat).toBeCloseTo(38, 0)
  })

  it('only offers packs that are published on the region', async () => {
    const [creatures] = await db.select().from(packs).where(eq(packs.slug, 'creatures'))
    await db.update(packs).set({ currentVersionId: null }).where(eq(packs.id, creatures.id))
    try {
      const found = await freePortraits('world')
      expect(found.some((portrait) => portrait.pack === 'creatures')).toBe(false)
    } finally {
      await db.update(packs).set({ currentVersionId: creatures.currentVersionId })
        .where(eq(packs.id, creatures.id))
    }
  })

  it('is empty for an unknown region', async () => {
    expect(await freePortraits('no-such-region')).toEqual([])
  })
})

describe('tourCovers', () => {
  it('gives each tour the first freely licensed figure it visits', async () => {
    const covers = await tourCovers()
    expect(covers.get('aristotle-in-translation')).toMatchObject({
      name: 'Aristotle',
      src: '/images/philosophy/aristotle.jpg',
    })
    // Its first stop, Gilgamesh, has no freely licensed image, so the cover
    // is the next stop that has one.
    expect(covers.get('gods-grew-quiet')?.name).toBe('Marduk')
  })
})
