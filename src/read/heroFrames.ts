import { sql } from 'drizzle-orm'
import { db } from '../db/client'
import { boundaries, regions } from '../db/schema'

/** One moment of a region, as SVG path data. */
export interface HeroFrame {
  year: number
  /** An `ST_AsSVG` path in lng/lat, y already negated for SVG's axis. */
  path: string
}

/**
 * Where in the region's span to take the three plates.
 *
 * Not the endpoints: the first year a corpus covers tends to be nearly empty
 * and the last is whatever it happened to stop at, and a hero that opens on a
 * blank plate reads as broken rather than as early. These sit inside both ends
 * and far enough apart that the borders visibly differ, which is the entire
 * thing the animation has to say.
 */
const AT = [0.2, 0.55, 0.9]

/**
 * Simplification, in degrees. About 90 km — far coarser than the map allows
 * itself, and correct here: this is a backdrop a few hundred pixels tall, and
 * detail no one can see is bytes in the document for nothing.
 */
const TOLERANCE = 0.8

/** Square degrees below which a polity is dropped. Detail, not territory. */
const FLOOR = 3

/**
 * Poles trimmed. Antarctica and the top of Greenland are a third of an
 * equirectangular plate's height and say nothing about who ruled what.
 */
const PLATE = { west: -180, south: -58, east: 180, north: 78 } as const

/** The plate's viewBox, matching `PLATE` with y negated as `ST_AsSVG` emits it. */
export const PLATE_VIEWBOX =
  `${PLATE.west} ${-PLATE.north} ${PLATE.east - PLATE.west} ${PLATE.north - PLATE.south}`

/** The first and last year a region has borders for, or null if it has none. */
export async function borderSpan(
  regionSlug: string,
): Promise<{ first: number; last: number } | null> {
  const [row] = await db
    .select({
      first: sql<number | null>`min(lower(${boundaries.valid}))`,
      last: sql<number | null>`max(upper(${boundaries.valid})) - 1`,
    })
    .from(boundaries)
    .where(sql`${boundaries.geom} && (select bbox from ${regions} where slug = ${regionSlug})`)

  if (row?.first == null || row.last == null) return null
  return { first: row.first, last: row.last }
}

/**
 * Three moments of a region's borders, for the landing page's hero.
 *
 * The claim the landing page makes is that the map is redrawn to match a year.
 * Rather than say so and illustrate it with a picture of something else, this
 * is the same `boundaries` table the atlas draws, at three years, rendered by
 * Postgres straight to SVG path data. There is no build step and no artifact:
 * the whole thing costs about 80 ms cold and 30 ms warm, which is cheaper than
 * the machinery that would avoid it.
 *
 * Returns an empty array for a region with no boundaries yet — the page then
 * renders its hero without a plate rather than with three blank ones.
 */
export async function heroFrames(regionSlug: string): Promise<HeroFrame[]> {
  const coverage = await borderSpan(regionSlug)
  if (!coverage) return []

  const span = coverage.last - coverage.first
  const years = AT.map((at) => Math.round(coverage.first + span * at))

  const frames = await Promise.all(years.map(async (year) => {
    const [row] = await db.execute(sql`
      select ST_AsSVG(
        ST_SimplifyPreserveTopology(
          ST_CollectionExtract(ST_MakeValid(ST_Collect(ST_Intersection(
            ${boundaries.geom},
            ST_MakeEnvelope(${PLATE.west}, ${PLATE.south}, ${PLATE.east}, ${PLATE.north}, 4326)
          ))), 3),
          ${TOLERANCE}
        ),
        -- Absolute coordinates, one decimal. A tenth of a degree is about
        -- eleven kilometres, which at this size is a third of a pixel.
        0, 1
      ) as path
      from ${boundaries}
      where valid @> ${year}::int and ST_Area(${boundaries.geom}) > ${FLOOR}
    `) as unknown as Array<{ path: string | null }>

    return { year, path: row?.path ?? '' }
  }))

  return frames.filter((frame) => frame.path.startsWith('M'))
}
