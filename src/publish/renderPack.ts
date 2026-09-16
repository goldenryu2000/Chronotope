import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../db/client'
import {
  entities, entityTraditions, eraSets, eras, packs, regions, traditions,
} from '../db/schema'
import { type Pack, PackSchema } from '../data/schemas'

/** PostGIS gives `POINT(lng lat)` — longitude first, which reads backwards. */
function parsePoint(ewkt: string): { lat: number; lng: number } {
  const match = /POINT\((-?[\d.]+) (-?[\d.]+)\)/.exec(ewkt)
  if (!match) throw new Error(`unparseable point: ${ewkt}`)
  return { lng: Number(match[1]), lat: Number(match[2]) }
}

export async function renderPack(packId: string): Promise<Pack> {
  const [pack] = await db.select().from(packs).where(eq(packs.id, packId))
  if (!pack) throw new Error(`no such pack: ${packId}`)

  const traditionRows = await db.select().from(traditions)
    .where(eq(traditions.packId, packId))
    .orderBy(asc(traditions.slug))
  const traditionById = new Map(traditionRows.map((t) => [t.id, t.slug]))

  const entityRows = await db
    .select({
      id: entities.slug,
      name: entities.name,
      span: entities.span,
      fuzzy: entities.fuzzy,
      point: sql<string>`ST_AsText(${entities.point})`,
      place: entities.place,
      tier: entities.tier,
      blurb: entities.blurb,
      ideas: entities.ideas,
      wikipedia: entities.wikipedia,
      wikidata: entities.wikidata,
      image: entities.image,
      rowId: entities.id,
    })
    .from(entities)
    .where(eq(entities.packId, packId))
    .orderBy(asc(entities.slug))

  const links = await db
    .select({ entityId: entityTraditions.entityId, traditionId: entityTraditions.traditionId })
    .from(entityTraditions)
  const traditionsFor = new Map<string, string[]>()
  for (const link of links) {
    const slug = traditionById.get(link.traditionId)
    if (!slug) continue
    const list = traditionsFor.get(link.entityId) ?? []
    list.push(slug)
    traditionsFor.set(link.entityId, list)
  }
  // `links` carries no ORDER BY (see comment above) so its row order is not
  // guaranteed. Sort each entity's tradition list by slug — not by DB row
  // order — so the artifact, and therefore its hash, is deterministic
  // regardless of what order Postgres happens to return rows in.
  for (const list of traditionsFor.values()) list.sort()

  // Era sets belonging to this pack, one per region it overrides.
  const overrideSets = await db
    .select({ setId: eraSets.id, regionSlug: regions.slug })
    .from(eraSets)
    .innerJoin(regions, eq(eraSets.regionId, regions.id))
    .where(eq(eraSets.packId, packId))

  const eraOverrides: Record<string, unknown[]> = {}
  for (const set of overrideSets) {
    const rows = await db.select().from(eras)
      .where(eq(eras.eraSetId, set.setId))
      .orderBy(asc(eras.ordinal))
    eraOverrides[set.regionSlug] = rows.map((e) => ({
      id: e.slug, label: e.label, start: e.start, end: e.end,
      weight: e.weight, blurb: e.blurb,
    }))
  }

  const artifact = {
    id: pack.slug,
    title: pack.title,
    subtitle: pack.subtitle,
    spanLabel: pack.spanLabel,
    activeOffset: pack.activeOffset,
    range: { start: pack.range[0], end: pack.range[1] - 1 },
    startYear: pack.startYear,
    traditions: traditionRows.map((t) => ({
      id: t.slug, label: t.label, regionLabel: t.regionLabel,
    })),
    entities: entityRows.map((e) => {
      const { lat, lng } = parsePoint(e.point)
      return {
        id: e.id,
        name: e.name,
        start: e.span[0],
        end: e.span[1] - 1, // int4range is end-exclusive
        fuzzy: e.fuzzy,
        lat,
        lng,
        place: e.place,
        traditions: traditionsFor.get(e.rowId) ?? [],
        tier: e.tier,
        blurb: e.blurb,
        ideas: e.ideas,
        wikipedia: e.wikipedia,
        wikidata: e.wikidata,
        ...(e.image ? { image: e.image } : {}),
      }
    }),
    eraOverrides,
  }

  // Validate here, so an unpublishable artifact fails in the pipeline rather
  // than in a visitor's browser.
  return PackSchema.parse(artifact)
}
