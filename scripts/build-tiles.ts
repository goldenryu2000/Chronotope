import './load-env'
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { sql } from 'drizzle-orm'
import { db } from '../src/db/client'
import { TileArchive } from '../src/tiles/archive'

/**
 * Where archives are written. Alongside `public/artifacts/`, and gitignored for
 * the same reason: it is generated from the database, and committing it would
 * recreate exactly the problem this milestone removes.
 */
export const TILE_DIR = join(process.cwd(), 'public', 'tiles')

export interface TileBuildResult {
  /** Absolute path to the archive written. */
  archive: string
  /** Bytes on disk. */
  bytes: number
  /** Boundary rows fed to tippecanoe. */
  features: number
  /** Distinct byte ranges in the archive. */
  tiles: number
  /** The largest single tile, compressed — the fattest request a client makes. */
  maxTileBytes: number
  /**
   * Input features that appear in no tile at the deepest zoom.
   *
   * Not a general "nothing was dropped" check, and it must not be read as one:
   * tippecanoe legitimately drops features below a pixel, so the low zooms are
   * expected to be missing polities — the world tile at zoom 0 carries 8,923
   * of the 10,614 rows and that is correct. The deepest zoom is different,
   * because the Jammu and Kashmir gate in Task 6 reads it, and a gate reading a
   * tile with features missing from it is not a gate.
   */
  droppedAtMaxZoom: number
  /**
   * The widest thing dropped at max zoom: the largest area ÷ perimeter, in
   * degrees, over the dropped rows. Zero when nothing was dropped.
   *
   * Area alone does not separate a small country from a sliver — this is the
   * average width of the shape, which does. Everything this corpus loses is a
   * near-collinear triangle left by upstream's quantisation, under 0.0006°
   * wide, which is about sixty metres. A real polity failing to reach max zoom
   * would show up here as a number orders of magnitude larger.
   */
  widestDropped: number
}

interface RegionRow {
  id: string
  min_zoom: number
  max_zoom: number
}

/**
 * Cut one vector-tile archive for a region, from the boundary rows themselves.
 *
 * Every era is in the one archive, tagged with the interval it is valid for, so
 * the client filters by year rather than fetching a file per year. That is the
 * whole architectural bet of this milestone, and it is why validity is an
 * attribute and not a layer.
 */
export async function buildTiles(regionSlug: string): Promise<TileBuildResult> {
  const regions = await db.execute(sql`
    select id, min_zoom, max_zoom from regions where slug = ${regionSlug}
  `) as unknown as RegionRow[]
  const region = regions[0]
  if (!region) throw new Error(`no region with slug ${regionSlug}`)

  const work = mkdtempSync(join(tmpdir(), 'chronotope-tiles-'))
  const input = join(work, `${regionSlug}.geojsonl`)
  mkdirSync(TILE_DIR, { recursive: true })
  const archive = join(TILE_DIR, `${regionSlug}.pmtiles`)

  try {
    const { features, width } = await writeGeojsonl(regionSlug, input)
    if (features === 0) throw new Error(`region ${regionSlug} has no boundaries to tile`)

    await runTippecanoe(input, archive, region.min_zoom, region.max_zoom)

    const reader = TileArchive.open(archive)
    try {
      const survived = idsAtZoom(reader, region.max_zoom)
      let dropped = 0
      let widest = 0
      for (let fid = 1; fid <= features; fid++) {
        if (survived.has(fid)) continue
        dropped += 1
        widest = Math.max(widest, width[fid])
      }

      const result: TileBuildResult = {
        archive,
        bytes: statSync(archive).size,
        features,
        tiles: reader.entries.length,
        maxTileBytes: reader.maxTileBytes,
        droppedAtMaxZoom: dropped,
        widestDropped: widest,
      }
      await db.execute(sql`
        update regions set tileset_key = ${`tiles/${regionSlug}.pmtiles`}
        where id = ${region.id}::uuid
      `)
      return result
    } finally {
      reader.close()
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Stream the region's boundaries out as GeoJSON Lines.
 *
 * Streamed through a cursor rather than collected: the geometry is around
 * 12 MB of text for the world, and holding all of it as JavaScript strings
 * before writing a byte is a needless spike. `ST_AsGeoJSON` is asked for
 * explicitly because a geometry column read plainly comes back as hex EWKB.
 *
 * The feature id is the row's ordinal, handed to tippecanoe as the MVT feature
 * id so `droppedAtMaxZoom` can be counted exactly. tippecanoe moves it out of
 * the properties, so it costs nothing per tile.
 */
async function writeGeojsonl(
  regionSlug: string, path: string,
): Promise<{ features: number; width: number[] }> {
  const client = db.$client
  const out = createWriteStream(path)
  let features = 0
  // Indexed by fid, which starts at 1; index 0 is never read.
  const width: number[] = [0]

  const query = client`
    select
      row_number() over (order by b.id) as fid,
      -- The name column, not properties->>'NAME'. 4,211 rows are nameless and
      -- the two disagree on one of them: the column is what the importer
      -- decided, the properties blob is what upstream happened to say.
      b.name,
      coalesce(b.properties->>'SUBJECTO', '') as subject_to,
      lower(b.valid) as valid_from,
      upper(b.valid) as valid_to,
      b.confidence,
      -- Average width in degrees, for the max-zoom drop check. Computed here
      -- because the fid is assigned here, and a second query would have to
      -- reproduce this WHERE clause exactly to number the rows the same way.
      (ST_Area(b.geom) / nullif(ST_Perimeter(b.geom), 0))::float8 as width,
      ST_AsGeoJSON(ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(b.geom, r.bbox)), 3
      )) as geometry
    from boundaries b, regions r
    where r.slug = ${regionSlug}
      and b.geom && r.bbox
      and not ST_IsEmpty(ST_CollectionExtract(
        ST_MakeValid(ST_Intersection(b.geom, r.bbox)), 3
      ))
  `.cursor(200)

  for await (const rows of query) {
    let chunk = ''
    for (const row of rows as unknown as Array<Record<string, unknown>>) {
      features += 1
      const fid = Number(row.fid)
      width[fid] = Number(row.width ?? 0)
      chunk += `${JSON.stringify({
        type: 'Feature',
        properties: {
          fid,
          name: row.name,
          subject_to: row.subject_to,
          valid_from: row.valid_from,
          valid_to: row.valid_to,
          confidence: row.confidence,
        },
        geometry: JSON.parse(row.geometry as string),
      })}\n`
    }
    if (!out.write(chunk)) await once(out, 'drain')
  }

  out.end()
  await once(out, 'finish')
  return { features, width }
}

/**
 * `--drop-densest-as-needed` is what keeps a tile under tippecanoe's own
 * 500 KB ceiling, and `maxTileBytes` in the result is the check that it did.
 * Without it a tile over the ceiling is simply not written, which fails as
 * missing borders on screen rather than as an error here.
 */
function runTippecanoe(
  input: string, archive: string, minZoom: number, maxZoom: number,
): Promise<void> {
  const args = [
    `-Z${minZoom}`, `-z${maxZoom}`,
    '--layer=borders',
    '--use-attribute-for-id=fid',
    '--drop-densest-as-needed',
    '--force',
    '-o', archive,
    input,
  ]
  return new Promise((resolve, reject) => {
    // Inherited stderr, so the progress and the feature count land in the
    // terminal where they are read, rather than in a buffer nobody prints.
    const child = spawn('tippecanoe', args, { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', (err) => {
      reject(new Error(
        `could not run tippecanoe (${err.message}). `
        + 'It is AUR-only on Arch; see scripts/check-tiletools.sh.',
      ))
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tippecanoe exited ${code}`))
    })
  })
}

/** Which input features survive into the tiles at one zoom. */
function idsAtZoom(reader: TileArchive, zoom: number): Set<number> {
  const seen = new Set<number>()
  for (const entry of reader.entriesAtZoom(zoom)) {
    const layer = new VectorTile(new PbfReader(reader.bytesOf(entry))).layers.borders
    if (!layer) continue
    for (let i = 0; i < layer.length; i++) {
      const id = layer.feature(i).id
      if (typeof id === 'number') seen.add(id)
    }
  }
  return seen
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const run = async () => {
    const slug = process.argv[2] ?? 'world'
    const started = Date.now()
    const result = await buildTiles(slug)
    const elapsed = (Date.now() - started) / 1000
    console.log(
      `Built ${result.archive}: ${result.features} features into ${result.tiles} tiles, `
      + `${(result.bytes / 1e6).toFixed(2)} MB, largest tile `
      + `${(result.maxTileBytes / 1024).toFixed(0)} KB, `
      + `${result.droppedAtMaxZoom} features missing at max zoom `
      + `(widest ${result.widestDropped.toExponential(2)}°), `
      + `in ${elapsed.toFixed(1)}s.`,
    )
  }

  run()
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
    .finally(async () => {
      await db.$client.end()
    })
}
