import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { entities, eraSets, packs, regions, tourStops, tours } from '../db/schema'

/**
 * Licences whose images can be shown without a caption.
 *
 * The landing page is a wall of small pictures, and CC BY and CC BY-SA would
 * each need an author, a source link and a licence link beside them. Rather
 * than print forty captions, the page shows only images that need none. The
 * entity page and the panel still credit every image they show.
 */
export const FREE_LICENCES = ['Public domain', 'CC0']

const licenceList = () => sql.join(FREE_LICENCES.map((licence) => sql`${licence}`), sql`, `)

/** A figure with a freely licensed image, as the landing page draws it. */
export interface Portrait {
  pack: string
  slug: string
  name: string
  /** Inclusive first year. */
  start: number
  /** Inclusive last year. */
  end: number
  lng: number
  lat: number
  /** Root-relative, served from `public/images`. */
  src: string
}

/**
 * Every freely licensed portrait on a region's published packs.
 *
 * The same doors `publishedAtlases` offers: a pack laid over the region
 * through `era_sets`, with the region and the pack both published. A picture
 * of a figure in a pack that does not open would be a picture of nothing.
 *
 * About a hundred rows over indexed joins, once per ISR window.
 */
export async function freePortraits(regionSlug: string): Promise<Portrait[]> {
  const rows = await db.execute(sql`
    select ${packs.slug} as pack, ${entities.slug} as slug, ${entities.name} as name,
      lower(${entities.span}) as start, upper(${entities.span}) - 1 as "end",
      ST_X(${entities.point}) as lng, ST_Y(${entities.point}) as lat,
      ${entities.image}->>'file' as file
    from ${entities}
    join ${packs} on ${packs.id} = ${entities.packId}
    join ${eraSets} on ${eraSets.packId} = ${packs.id}
    join ${regions} on ${regions.id} = ${eraSets.regionId}
    where ${regions.slug} = ${regionSlug}
      and ${regions.currentArtifactKey} is not null
      and ${packs.currentVersionId} is not null
      and ${entities.image}->>'licence' in (${licenceList()})
    order by ${packs.slug}, lower(${entities.span}), ${entities.slug}
  `) as unknown as Array<{
    pack: string; slug: string; name: string; start: number; end: number
    lng: number; lat: number; file: string
  }>

  return rows.map(({ file, ...row }) => ({
    ...row,
    start: Number(row.start),
    end: Number(row.end),
    lng: Number(row.lng),
    lat: Number(row.lat),
    src: `/images/${row.pack}/${file}`,
  }))
}

/** A tour's picture: a name for the alt text and where the file is. */
export interface TourCover {
  name: string
  src: string
}

/**
 * For each published tour, the first figure it visits that has a freely
 * licensed image. A tour whose stops have none is simply absent.
 */
export async function tourCovers(): Promise<Map<string, TourCover>> {
  const rows = await db.execute(sql`
    select distinct on (${tours.slug})
      ${tours.slug} as tour, ${entities.name} as name,
      ${packs.slug} as pack, ${entities.image}->>'file' as file
    from ${tourStops}
    join ${tours} on ${tours.id} = ${tourStops.tourId}
    join ${entities} on ${entities.id} = ${tourStops.entityId}
    join ${packs} on ${packs.id} = ${entities.packId}
    where ${tours.currentVersionId} is not null
      and ${entities.image}->>'licence' in (${licenceList()})
    order by ${tours.slug}, ${tourStops.ordinal}
  `) as unknown as Array<{ tour: string; name: string; pack: string; file: string }>

  return new Map(rows.map((row) => [
    row.tour,
    { name: row.name, src: `/images/${row.pack}/${row.file}` },
  ]))
}
