import './load-env'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { sql, type SQL } from 'drizzle-orm'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { db } from '../src/db/client'
import { boundaries } from '../src/db/schema'
import { foldIntervals, type Observation } from '../src/boundaries/intervals'
import {
  applyIndiaClaim, FIRST_CORRECTED_YEAR, type ClaimResult,
} from '../src/boundaries/indiaClaim'

/**
 * The 48 upstream snapshots, and the only thing that still reads them.
 *
 * They lived under `public/` while the browser fetched one per year. Milestone
 * 2 made a year a filter over one archive, so nothing serves them any more —
 * but they are still the source the `boundaries` table is built from, so they
 * move to `data/` beside `india-claim.geojson` rather than being deleted.
 */
export const SNAPSHOT_DIR = join(process.cwd(), 'data', 'borders')

/**
 * Degrees of positional slack allowed when deciding whether two snapshots show
 * the same shape — the largest distance any point may have moved.
 *
 * TopoJSON quantises per file, so byte-identical geometry is not expected even
 * when nothing changed. This is not a small effect: the 48 files quantise onto
 * grids from 0.0054° to 0.0202°, so the *same* real-world outline comes back
 * displaced by up to about a grid cell between two files.
 *
 * 0.02 is measured, not chosen by taste. It is the coarsest quantisation grid
 * in the corpus (0.02016), and the observed distribution of Hausdorff distance
 * between consecutive appearances of a polity agrees, falling off a cliff
 * exactly there — 4,037 pairs below 0.02°, then 36 in [0.02, 0.03) and 23 in
 * [0.03, 0.04). A trough, though, not a gap: the far side is thinly but
 * *continuously* populated (Desert hunter-gatherers 0.0200, Khoiasan 0.0202,
 * Bijapur/Ahmadnagar 0.0210, Croatia 0.0221, Baden 0.0223, Benin 0.0228), so
 * do not read this as two cleanly separated populations. What it does mean is
 * that the value is not delicate — anything in [0.02, 0.03] gives nearly the
 * same answer — and that the pairs just above the line stay split, which is
 * the harmless direction to err in.
 *
 * See the note on `shapeKeys` for why md5-of-precision-reduced-geometry — the
 * obvious approach, and this task's first attempt — cannot work at this scale
 * of noise.
 */
export const PRECISION_TOLERANCE = 0.02

/**
 * The second half of the identity test: the symmetric difference between two
 * shapes may not exceed this fraction of their union.
 *
 * Hausdorff alone is not enough for small polities. Wulgurukaba and Jaburrara
 * are a few grid cells across, so quantisation moves no point more than 0.008°
 * and still changes 91% of the area. That is not evidence of sameness, it is
 * the absence of evidence either way — and the failure costs here are
 * asymmetric. Merging two shapes that differ puts wrong borders on screen;
 * keeping two rows that could have been one costs a little disk. So merging
 * requires positive evidence on both measures and anything ambiguous stays as
 * two rows.
 *
 * At 5%, 3,717 of the 4,037 Hausdorff-passing pairs still merge; the 320 that
 * drop out are exactly the tiny-polygon cases above.
 */
export const AREA_TOLERANCE = 0.05

/** Staging rows written per INSERT, and comparisons per identity query.
 * One statement per row across 16,677 geometries is all round trip. */
const BATCH = 200

interface BorderProps {
  NAME: string | null
  SUBJECTO: string | null
  PARTOF: string | null
  BORDERPRECISION: number | null
}

interface SnapshotMeta { year: number; file: string }

const CONFIDENCE: Record<number, 'low' | 'medium' | 'high'> = {
  1: 'low',
  2: 'medium',
  3: 'high',
}

interface StagedRow {
  id: number
  year: number
  name: string
  props: BorderProps
}

export interface ImportResult {
  snapshots: number
  /** Features that reached the staging table — the denominator of the ratio. */
  observations: number
  /** Features dropped: no geometry at all, or nothing polygonal left once
   * ST_MakeValid was done with them. See `skipped` handling below. */
  skipped: number
  /** Rows written to `boundaries`, one per (polity, validity interval). */
  rows: number
  /** Rows the Jammu and Kashmir correction touched; zeroes when it was skipped. */
  corrected: ClaimResult
}

/**
 * True when `a` and `b` are the same shape to the limits of this data.
 *
 * Deliberately *not* a comparison of structure, and deliberately not a hash.
 * PostGIS rewinds rings, promotes Polygon to MultiPolygon and rounds, so a
 * no-op comes back structurally different — the old build's first attempt at
 * this class of check cheerfully reported having trimmed Luxembourg, Cuba and
 * Antarctica. The bounding-box reject in front of a real overlay is the shape
 * that check should have had.
 */
function sameShape(rep: SQL, obs: SQL, tolerance: number, areaTolerance: number): SQL {
  return sql`case
    when not (ST_Expand(${rep}, ${tolerance}) && ${obs}) then false
    else coalesce(
      ST_HausdorffDistance(${rep}, ${obs}) <= ${tolerance}
      and (ST_Area(${rep}) + ST_Area(${obs}) - 2 * ST_Area(ST_Intersection(${rep}, ${obs})))
          <= ${areaTolerance} * nullif(
               ST_Area(${rep}) + ST_Area(${obs}) - ST_Area(ST_Intersection(${rep}, ${obs})), 0),
      false)
  end`
}

/** Options, all measured defaults; see each constant for the evidence. */
export interface ImportOptions {
  tolerance?: number
  areaTolerance?: number
  /**
   * Empty `boundaries` first, inside the same transaction as the import.
   * Inside, not before: a crash mid-import must leave the previous contents
   * standing rather than an empty table, because Tasks 4-6 read it.
   */
  replace?: boolean
  /**
   * Apply the Jammu and Kashmir correction before committing. On by default:
   * an import that left it off would publish upstream's de facto lines.
   *
   * Only `indiaClaim.test.ts` passes false, because it needs the uncorrected
   * table to measure the correction against.
   */
  applyClaim?: boolean
}

/**
 * Read the snapshot directory and write one `boundaries` row per (polity,
 * validity interval).
 *
 * **Appends unless `replace` is passed.** There is no natural key to conflict
 * on — a polity legitimately has many rows — so calling this twice without
 * `replace` silently doubles every polity rather than failing. The CLI below
 * always passes it.
 */
export async function importBoundaries(
  dir = SNAPSHOT_DIR,
  {
    tolerance = PRECISION_TOLERANCE,
    areaTolerance = AREA_TOLERANCE,
    replace = false,
    applyClaim = true,
  }: ImportOptions = {},
): Promise<ImportResult> {
  const index: SnapshotMeta[] = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  const snapshotYears = index.map((meta) => meta.year).sort((a, b) => a - b)

  // One transaction for the whole import, and not only for atomicity: a
  // temporary table belongs to a session, and postgres-js hands out pooled
  // connections per statement. A transaction pins one connection, which is
  // what makes `staging` still be there on the next statement — and what lets
  // `on commit drop` clean it up.
  return db.transaction(async (tx) => {
    if (replace) await tx.delete(boundaries)

    await tx.execute(sql`
      create temporary table staging (
        id serial primary key,
        year int not null,
        name text not null,
        props jsonb not null,
        geom geometry(MultiPolygon, 4326) not null
      ) on commit drop
    `)

    let skipped = 0

    for (const meta of index) {
      const topology = JSON.parse(
        readFileSync(join(dir, meta.file), 'utf8'),
      ) as Topology<{ borders: GeometryCollection<BorderProps> }>
      const collection = feature(topology, topology.objects.borders)

      const values: SQL[] = []
      for (const f of collection.features) {
        if (!f.geometry) {
          skipped += 1
          continue
        }
        const props = (f.properties ?? {}) as BorderProps
        values.push(sql`(
          ${meta.year}::int,
          ${props.NAME ?? ''}::text,
          ${JSON.stringify(props)}::jsonb,
          ST_Multi(ST_CollectionExtract(
            ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}::text), 4326)),
            3
          ))
        )`)
      }

      for (let i = 0; i < values.length; i += BATCH) {
        await tx.execute(sql`
          insert into staging (year, name, props, geom)
          values ${sql.join(values.slice(i, i + BATCH), sql`, `)}
        `)
      }
    }

    // ST_CollectionExtract keeps the column's MultiPolygon contract when
    // ST_MakeValid hands back a collection of lines and polygons, but it can
    // also leave nothing behind. 724 upstream features already have exactly
    // zero area before PostGIS touches them — mapshaper's `remove-empty` runs
    // before quantization, so anything quantization then collapses (upstream's
    // post-1994 "Switzerland" is a 100-metre triangle near the Matterhorn)
    // survives into the published files as a degenerate polygon. A shape with
    // no area is not an observation of anything, so it is a skip, not a row.
    const [emptied] = await tx.execute(sql`
      with gone as (delete from staging where ST_IsEmpty(geom) returning 1)
      select count(*)::int as n from gone
    `) as unknown as Array<{ n: number }>
    skipped += emptied.n

    const staged = await tx.execute(sql`
      select id, year, name, props from staging order by name, year, id
    `) as unknown as StagedRow[]

    const groups = await groupObservations(tx, staged, tolerance, areaTolerance)
    const shapeKeys = await resolveShapeKeys(tx, groups, tolerance, areaTolerance)

    const byId = new Map(staged.map((row) => [row.id, row]))
    const pending: SQL[] = []
    for (const group of groups.values()) {
      const observations: Observation[] = group.rows.map((row) => ({
        year: row.year,
        shapeKey: shapeKeys.get(row.id)!,
      }))
      for (const interval of foldIntervals(observations, snapshotYears)) {
        // The shape key *is* the staging id of the representative geometry, so
        // the row to copy needs no second lookup table.
        const source = byId.get(Number(interval.shapeKey))!
        // The snapshots this row was actually observed in, not the years its
        // validity covers: an interval [1600, 1650) rests on the 1600 snapshot
        // alone, and citing "1600..1649" would name 49 snapshots that do not
        // exist. `to` is the next snapshot year (or last + 1), so the last
        // snapshot in the run is the greatest snapshot year below it.
        const last = snapshotYears.filter((year) => year < interval.to).at(-1)!
        pending.push(sql`(
          ${group.name}::text,
          ${source.id}::int,
          ${interval.from}::int,
          ${interval.to}::int,
          ${'historical-basemaps (aourednik), '
            + (last === interval.from
              ? `snapshot ${interval.from}`
              : `snapshots ${interval.from}..${last}`)
            + '; validity derived from snapshot spacing, not a historical change date'}::text,
          ${CONFIDENCE[source.props?.BORDERPRECISION ?? 1] ?? 'low'}::text,
          ${JSON.stringify(source.props)}::jsonb
        )`)
      }
    }

    // Measured on this output, not assumed: the parent design's claim that no
    // two boundaries at the same admin_level may overlap during overlapping
    // validity is **false** for this data — 5,576 pairs overlap by more than
    // 0.01 square degrees. That is not a bug in the import and must not be
    // "fixed" in the data. Polities nest, claims are contested, and upstream
    // draws hunter-gatherer ranges as overlapping because they were: Cree,
    // Dënéndeh, Michif Piyii and Očhéthi Šakówiŋ all cover each other in 1492,
    // and the Emirate of Bin Shal'an sits inside 1938 Saudi Arabia. Anything
    // downstream that needs one polygon per point has to pick a winner itself.
    for (let i = 0; i < pending.length; i += BATCH) {
      await tx.execute(sql`
        insert into ${boundaries} (name, geom, valid, admin_level, source, confidence, properties)
        select v.name, s.geom, int4range(v.lo, v.hi), 2, v.source, v.confidence, v.props
        from (values ${sql.join(pending.slice(i, i + BATCH), sql`, `)})
          as v(name, staging_id, lo, hi, source, confidence, props)
        join staging s on s.id = v.staging_id
      `)
    }

    // Inside the transaction, so `boundaries` is never committed showing
    // upstream's de facto lines in Kashmir — not even for the moment between
    // the import and a follow-up statement.
    const corrected = applyClaim
      ? await applyIndiaClaim(tx)
      : { added: 0, trimmed: 0 }

    return {
      snapshots: index.length,
      observations: staged.length,
      skipped,
      rows: pending.length,
      corrected,
    }
  })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** One polity's observations, in snapshot order — the timeline foldIntervals folds. */
interface Group { name: string; rows: StagedRow[] }

/**
 * Gather staged features into one timeline per polity.
 *
 * A name is an identity, so named features group by name and nothing else.
 * 5,427 of the 15,519 observations have `NAME: null` upstream, though —
 * unclaimed or unattributed territory, which the atlas has always drawn and
 * which would leave holes in the map if dropped. Those have no name to group
 * by, so their identity has to come from continuity: an unnamed shape in one
 * snapshot continues an unnamed shape in the *immediately preceding* snapshot
 * when the two match geometrically **and** the match is unique in both
 * directions. Anything with two plausible predecessors is ambiguous and starts
 * a new timeline instead. Measured on this corpus, 1,249 unnamed observations
 * find a predecessor and every single one of those matches is already unique,
 * so the tie-break costs nothing here — it is a guard against a future
 * snapshot set, not a fix for this one.
 *
 * Note the asymmetry with `resolveShapeKeys`, which deliberately compares each
 * observation against the representative of the open interval so that drift
 * cannot accumulate. Chaining here is predecessor-to-predecessor instead, and
 * that is the only place in the importer where it is, because grouping and
 * identity answer different questions: this one only decides *which timeline*
 * an unnamed shape belongs to, and `resolveShapeKeys` then re-measures every
 * member of that timeline against the representative before anything merges.
 * A chain that wanders is therefore split back apart there — grouping too
 * generously costs extra rows, never a wrong merge. Measured, unnamed drift
 * reaches 0.0195°, inside one tolerance, so it does not arise here either.
 */
async function groupObservations(
  tx: Tx,
  staged: StagedRow[],
  tolerance: number,
  areaTolerance: number,
): Promise<Map<string, Group>> {
  const matched = await tx.execute(sql`
    with adjacent as (
      select year as y, lag(year) over (order by year) as py
      from (select distinct year from staging) years
    ),
    matches as (
      select later.id as obs_id, earlier.id as prev_id
      from adjacent
      join staging later on later.year = adjacent.y and later.name = ''
      join staging earlier on earlier.year = adjacent.py and earlier.name = ''
      where ${sameShape(sql`earlier.geom`, sql`later.geom`, tolerance, areaTolerance)}
    )
    select obs_id, prev_id from matches
    where obs_id in (select obs_id from matches group by obs_id having count(*) = 1)
      and prev_id in (select prev_id from matches group by prev_id having count(*) = 1)
  `) as unknown as Array<{ obs_id: number; prev_id: number }>
  const predecessor = new Map(matched.map((m) => [m.obs_id, m.prev_id]))

  const groups = new Map<string, Group>()
  const groupOf = new Map<number, string>()
  // `staged` is ordered by name then year, so an unnamed row's predecessor has
  // always been seen by the time the row itself is.
  for (const row of staged) {
    let key: string
    if (row.name !== '') {
      key = `n ${row.name}`
    } else {
      const prev = predecessor.get(row.id)
      key = (prev !== undefined ? groupOf.get(prev) : undefined) ?? `u ${row.id}`
    }
    groupOf.set(row.id, key)
    const group = groups.get(key) ?? { name: row.name, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return groups
}

/**
 * Give every observation a shape key: observations that share one are the same
 * shape, and `foldIntervals` collapses a contiguous run of them into a single
 * validity interval.
 *
 * The obvious implementation — `md5(ST_AsBinary(ST_ReducePrecision(
 * ST_Normalize(geom), tol)))`, computed in Postgres so it sees exactly the
 * geometry that will be stored — was tried first and does not work on this
 * data. Snapping to a grid only makes two point sets equal when the noise is
 * far below the grid, and here the noise *is* a grid, of comparable size and
 * different per file. Measured end to end over all 15,519 observations, that
 * hash gives 15,330 rows (1.01x) at tolerances 0.000001, 0.00001 and 0.0001 —
 * identically, along with 0.001 — then 15,304 at 0.01 and 14,549 at 0.05. No
 * value of it is both safe and useful: nothing moves below 5.5 km of slack,
 * and 5.5 km flattens real border changes. It is worth knowing that the
 * failure is silent — no error, no warning, just a table with one row per
 * snapshot and a dedup ratio of 1.0.
 *
 * So identity is a geometric predicate instead (see `sameShape`), applied
 * against the *representative* of the interval currently open rather than
 * against the previous observation. Comparing against the predecessor would
 * let a shape drift by one tolerance per snapshot and still count as
 * unchanged; comparing against the representative bounds total drift by the
 * tolerance, whatever the run length.
 *
 * The comparisons are batched by position within the timeline — round k
 * compares every group's k-th observation at once — so this costs one query
 * per round (48 at most, one per snapshot) rather than one per comparison.
 */
async function resolveShapeKeys(
  tx: Tx,
  groups: Map<string, Group>,
  tolerance: number,
  areaTolerance: number,
): Promise<Map<number, string>> {
  const keys = new Map<number, string>()
  const representative = new Map<string, number>()
  for (const [key, group] of groups) {
    representative.set(key, group.rows[0].id)
    keys.set(group.rows[0].id, String(group.rows[0].id))
  }

  const longest = Math.max(0, ...[...groups.values()].map((g) => g.rows.length))
  for (let k = 1; k < longest; k += 1) {
    const pairs: Array<{ key: string; repId: number; obsId: number }> = []
    for (const [key, group] of groups) {
      if (group.rows.length > k) {
        pairs.push({ key, repId: representative.get(key)!, obsId: group.rows[k].id })
      }
    }

    const verdicts = new Map<number, boolean>()
    for (let i = 0; i < pairs.length; i += BATCH) {
      const values = pairs.slice(i, i + BATCH)
        .map((p) => sql`(${p.repId}::int, ${p.obsId}::int)`)
      const answered = await tx.execute(sql`
        select v.obs_id, ${sameShape(sql`rep.geom`, sql`obs.geom`, tolerance, areaTolerance)} as same
        from (values ${sql.join(values, sql`, `)}) as v(rep_id, obs_id)
        join staging rep on rep.id = v.rep_id
        join staging obs on obs.id = v.obs_id
      `) as unknown as Array<{ obs_id: number; same: boolean }>
      for (const row of answered) verdicts.set(row.obs_id, row.same)
    }

    for (const pair of pairs) {
      if (verdicts.get(pair.obsId)) {
        keys.set(pair.obsId, String(pair.repId))
      } else {
        // A new shape: it becomes the representative every later observation
        // in this timeline is measured against.
        representative.set(pair.key, pair.obsId)
        keys.set(pair.obsId, String(pair.obsId))
      }
    }
  }

  return keys
}

// CLI entry point. Guarded so importing this module (e.g. from the test file)
// never triggers a real import against the database.
const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const run = async () => {
    const started = Date.now()
    const tolerance = Number(process.env.PRECISION_TOLERANCE ?? PRECISION_TOLERANCE)
    const areaTolerance = Number(process.env.AREA_TOLERANCE ?? AREA_TOLERANCE)
    // `replace` is unscoped and destructive — `boundaries` holds nothing but
    // this import's output, and clearing it is what makes a re-run start clean
    // rather than doubling every polity. It happens inside the import's own
    // transaction, so a failure part-way leaves the old rows standing.
    const result = await importBoundaries(SNAPSHOT_DIR, {
      tolerance, areaTolerance, replace: true,
    })
    const elapsed = (Date.now() - started) / 1000

    console.log(
      `Imported ${result.snapshots} snapshots: `
      + `${result.observations} observations (${result.skipped} skipped) `
      + `folded into ${result.rows} rows — `
      + `${(result.observations / result.rows).toFixed(2)}x dedup `
      + `at tolerance ${tolerance}/${areaTolerance}, in ${elapsed.toFixed(1)}s.`,
    )
    console.log(
      `Jammu and Kashmir correction from ${FIRST_CORRECTED_YEAR}: `
      + `claim added to ${result.corrected.added} India rows, `
      + `subtracted from ${result.corrected.trimmed} others.`,
    )
  }

  run()
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(async () => {
      const client = db.$client
      await client.end()
    })
}
