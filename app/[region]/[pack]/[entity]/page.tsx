import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { and, asc, eq } from 'drizzle-orm'
import { isSlug } from '@/src/data/schemas'
import { db } from '@/src/db/client'
import { entities, entityTraditions, packs, regions, traditions } from '@/src/db/schema'
import { formatYear } from '@/src/lib/year'
import ImageCredit from '@/src/panel/ImageCredit'
import './page.css'

interface EntityRecord {
  name: string
  place: string
  /** Inclusive first year, per the year rules in src/lib/year.ts. */
  start: number
  /** Inclusive last year — one less than the stored range's exclusive end. */
  end: number
  fuzzy: boolean
  blurb: string
  ideas: string[]
  wikipedia: string
  image: { file: string; credit: string; licence: string; source: string } | null
  /** What the span means for this pack: "lived", "attested". Not this file's business to guess. */
  spanLabel: string
  packTitle: string
  packSlug: string
  traditions: string[]
}

/**
 * The one query this route exists to make: straight to Postgres, not the
 * published artifact. This is a server render, not the atlas, so the
 * artifact-only read path (src/read/currentArtifact.ts) does not apply here —
 * see the task brief.
 *
 * Wrapped in React's `cache` so the page and `generateMetadata`, which both
 * need the same row, share one round trip instead of two. `fetch` gets this
 * for free; a `db` call needs it spelled out.
 */
const loadEntity = cache(async (
  region: string,
  pack: string,
  entity: string,
): Promise<EntityRecord | null> => {
  if (![region, pack, entity].every(isSlug)) return null
  // The atlas route 404s on an unknown region; a URL like
  // /nonsense/philosophy/laozi should not render here either.
  const [regionRow] = await db
    .select({ id: regions.id })
    .from(regions)
    .where(eq(regions.slug, region))
    .limit(1)
  if (!regionRow) return null

  const [row] = await db
    .select({
      id: entities.id,
      name: entities.name,
      place: entities.place,
      span: entities.span,
      fuzzy: entities.fuzzy,
      blurb: entities.blurb,
      ideas: entities.ideas,
      wikipedia: entities.wikipedia,
      image: entities.image,
      spanLabel: packs.spanLabel,
      packTitle: packs.title,
    })
    .from(entities)
    .innerJoin(packs, eq(entities.packId, packs.id))
    .where(and(eq(packs.slug, pack), eq(entities.slug, entity)))
    .limit(1)
  if (!row) return null

  const traditionRows = await db
    .select({ label: traditions.label })
    .from(entityTraditions)
    .innerJoin(traditions, eq(entityTraditions.traditionId, traditions.id))
    .where(eq(entityTraditions.entityId, row.id))
    .orderBy(asc(traditions.label))

  return {
    name: row.name,
    place: row.place,
    // int4range is [lo, hi) — the last inclusive year is hi - 1. Reporting
    // `row.span[1]` as-is here would render Laozi's death a year late.
    start: row.span[0],
    end: row.span[1] - 1,
    fuzzy: row.fuzzy,
    blurb: row.blurb,
    ideas: row.ideas,
    wikipedia: row.wikipedia,
    image: row.image,
    spanLabel: row.spanLabel,
    packTitle: row.packTitle,
    packSlug: pack,
    traditions: traditionRows.map((t) => t.label),
  }
})

/**
 * One page per (region, pack, entity) triple that actually exists. Regions
 * are not hardcoded to "world" — the query walks whatever is in the regions
 * table, so a second region would get its own 300 pages without this file
 * changing.
 */
export async function generateStaticParams() {
  const [regionRows, entityRows] = await Promise.all([
    db.select({ slug: regions.slug }).from(regions),
    db
      .select({ pack: packs.slug, entity: entities.slug })
      .from(entities)
      .innerJoin(packs, eq(entities.packId, packs.id)),
  ])

  return regionRows.flatMap((region) =>
    entityRows.map((row) => ({ region: region.slug, pack: row.pack, entity: row.entity })),
  )
}

export async function generateMetadata(
  props: PageProps<'/[region]/[pack]/[entity]'>,
): Promise<Metadata> {
  const { region, pack, entity } = await props.params
  const record = await loadEntity(region, pack, entity)
  if (!record) return {}

  return {
    // No suffix here — the root layout's `title.template` appends
    // "— Chronotope", and spelling it out again would double it.
    title: record.name,
    description: record.blurb,
  }
}

export default async function Page(props: PageProps<'/[region]/[pack]/[entity]'>) {
  const { region, pack, entity } = await props.params
  const record = await loadEntity(region, pack, entity)
  if (!record) notFound()

  return (
    <main className="entity">
      {/*
        * The way back to the map this came from.
        *
        * This page had none: it is reached by clicking a pin, and once here
        * the only exit was the browser's own button. It names its destination
        * rather than saying "back", because someone who arrived from a search
        * result never saw the map and "back" would not tell them where to.
        */}
      <Link className="entity__back" href={`/${region}/${pack}`}>
        <span className="entity__back-arrow" aria-hidden="true" />
        {record.packTitle}
      </Link>
      {/* A missing depiction is a warning, not a failure — 158 of 300
          entities have none, and the page has to read fine either way. */}
      {record.image && (
        <figure className="entity__figure">
          {/* A plain <img>, not next/image: a static file served from
              public/ at a size the page fixes in CSS. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="entity__image"
            src={`/images/${record.packSlug}/${record.image.file}`}
            /* Deliberately "depiction of", not a name alone — most of these
               are later artefacts, not likenesses made from life. */
            alt={`Depiction of ${record.name}`}
            width={320}
            height={320}
          />
          <ImageCredit block="entity" image={record.image} />
        </figure>
      )}

      <h1 className="entity__name">{record.name}</h1>

      <p className="entity__dates">
        {record.fuzzy && 'c. '}
        {formatYear(record.start)} – {formatYear(record.end)}
        {/* "lived" for a philosopher, "attested" for a god or a monster — the
            pack says which, this page just prints it. */}
        <span className="entity__span-label">{record.spanLabel}</span>
      </p>

      <p className="entity__place">{record.place}</p>

      {record.traditions.length > 0 && (
        <ul className="entity__traditions">
          {record.traditions.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}

      <p className="entity__blurb">{record.blurb}</p>

      {record.ideas.length > 0 && (
        <>
          <h2 className="entity__heading">Known for</h2>
          <ul className="entity__ideas">
            {record.ideas.map((idea) => (
              <li key={idea}>{idea}</li>
            ))}
          </ul>
        </>
      )}

      <a
        className="entity__link"
        href={record.wikipedia}
        target="_blank"
        rel="noreferrer noopener"
      >
        Read on Wikipedia
      </a>

      {record.fuzzy && (
        <p className="entity__note">
          Dates are estimates. A great deal of what this atlas covers is only datable to within a
          century.
        </p>
      )}
      <p className="entity__note">
        <Link href="/credits">Credits</Link>
      </p>
    </main>
  )
}
