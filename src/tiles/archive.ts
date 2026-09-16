import { closeSync, openSync, readSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { VectorTile } from '@mapbox/vector-tile'
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { PbfReader } from 'pbf'
import { bytesToHeader, zxyToTileId, type Header } from 'pmtiles'

/**
 * Reading a PMTiles archive from disk, in Node.
 *
 * The `pmtiles` package is written for the browser: its `PMTiles` class fetches
 * ranges over HTTP and its only bundled source wraps a DOM `File`. What it does
 * export, and what is worth borrowing rather than reimplementing, is the header
 * parser and the tile-id/z-x-y curve. Everything else here is the v3 directory
 * format, which the package keeps private.
 *
 * This exists so the build can be checked against the archive it actually
 * wrote, rather than against the database the archive came from. Those are
 * different artefacts and simplification sits between them.
 */

/** One tile's position in the archive. Leaf indirection is already resolved. */
export interface TileEntry {
  /** Hilbert-curve tile id; `tileIdToZxy` turns it back into coordinates. */
  tileId: number
  /** Byte offset from the start of the tile data section. */
  offset: number
  /** Bytes on disk — compressed, which is what a client pays for. */
  length: number
  /** How many consecutive tile ids share these bytes. */
  runLength: number
}

/** PMTiles v3 compression codes. Only the two tippecanoe emits are handled. */
const COMPRESSION_NONE = 1
const COMPRESSION_GZIP = 2

const HEADER_BYTES = 127

/**
 * A LEB128 reader.
 *
 * Deliberately accumulates with multiplication rather than `<<`: JavaScript's
 * bitwise operators truncate to 32 bits, and a tile id at zoom 16 does not fit
 * in 32 bits. This is a silent wrong answer, not an error, which is the kind
 * worth spending three lines to avoid.
 */
class Varints {
  private pos = 0

  constructor(private readonly buf: Buffer) {}

  get done(): boolean {
    return this.pos >= this.buf.length
  }

  next(): number {
    let value = 0
    let shift = 1
    for (;;) {
      const byte = this.buf[this.pos++]
      if (byte === undefined) throw new Error('truncated varint in pmtiles directory')
      value += (byte & 0x7f) * shift
      if ((byte & 0x80) === 0) return value
      shift *= 128
    }
  }
}

function decompress(bytes: Buffer, compression: number): Buffer {
  if (compression === COMPRESSION_GZIP) return gunzipSync(bytes)
  if (compression === COMPRESSION_NONE) return bytes
  throw new Error(`unsupported pmtiles compression ${compression}`)
}

/**
 * Decode one directory.
 *
 * The format stores each field for every entry before moving on to the next
 * field — all the tile ids, then all the run lengths, and so on — so it cannot
 * be read entry by entry. Tile ids are deltas from the previous one, and an
 * offset of zero means "immediately after the entry before it", which is how a
 * clustered archive spends almost nothing on offsets.
 */
function readDirectory(bytes: Buffer): TileEntry[] {
  const varints = new Varints(bytes)
  const count = varints.next()
  const entries: TileEntry[] = new Array(count)

  let tileId = 0
  for (let i = 0; i < count; i++) {
    tileId += varints.next()
    entries[i] = { tileId, offset: 0, length: 0, runLength: 0 }
  }
  for (let i = 0; i < count; i++) entries[i].runLength = varints.next()
  for (let i = 0; i < count; i++) entries[i].length = varints.next()
  for (let i = 0; i < count; i++) {
    const value = varints.next()
    entries[i].offset = value === 0 && i > 0
      ? entries[i - 1].offset + entries[i - 1].length
      : value - 1
  }
  return entries
}

/** An open archive. Call `close` when finished; the tests do it in `afterAll`. */
export class TileArchive {
  private constructor(
    private readonly fd: number,
    readonly header: Header,
    /** Every tile in the archive, in tile-id order. */
    readonly entries: readonly TileEntry[],
  ) {}

  static open(path: string): TileArchive {
    const fd = openSync(path, 'r')
    try {
      const head = Buffer.alloc(HEADER_BYTES)
      readSync(fd, head, 0, HEADER_BYTES, 0)
      // `bytesToHeader` wants an ArrayBuffer, not a view of one, and a Buffer
      // may be a window into a shared pool — so slice, which copies.
      const header = bytesToHeader(
        head.buffer.slice(head.byteOffset, head.byteOffset + head.byteLength),
      )

      const read = (offset: number, length: number): Buffer => {
        const buf = Buffer.alloc(length)
        readSync(fd, buf, 0, length, offset)
        return buf
      }

      const root = readDirectory(decompress(
        read(header.rootDirectoryOffset, header.rootDirectoryLength),
        header.internalCompression,
      ))

      // A run length of zero marks a pointer into the leaf section rather than
      // a tile. Small archives have no leaves at all; this is here so the
      // reader does not quietly return a third of the tiles once one does.
      const tiles: TileEntry[] = []
      for (const entry of root) {
        if (entry.runLength > 0) {
          tiles.push(entry)
          continue
        }
        const leaf = readDirectory(decompress(
          read(header.leafDirectoryOffset + entry.offset, entry.length),
          header.internalCompression,
        ))
        for (const inner of leaf) {
          if (inner.runLength === 0) throw new Error('nested pmtiles leaf directories')
          tiles.push(inner)
        }
      }
      tiles.sort((a, b) => a.tileId - b.tileId)
      return new TileArchive(fd, header, tiles)
    } catch (err) {
      closeSync(fd)
      throw err
    }
  }

  /** The largest tile on disk, in bytes — what the fattest client request costs. */
  get maxTileBytes(): number {
    return this.entries.reduce((max, entry) => Math.max(max, entry.length), 0)
  }

  /** Tile ids covered, counting runs. Distinct byte ranges are `entries.length`. */
  get addressedTiles(): number {
    return this.entries.reduce((sum, entry) => sum + entry.runLength, 0)
  }

  /**
   * Every entry holding tiles at one zoom.
   *
   * By tile-id range rather than by `tileIdToZxy(entry.tileId)`, because an
   * entry is a *run*: identical tiles are stored once and addressed many
   * times, and 416 of this archive's 2,557 entries cover more than one tile.
   * Classifying a run by where it starts loses every tile after the first, and
   * a run that starts at one zoom can reach into the next.
   */
  entriesAtZoom(zoom: number): TileEntry[] {
    const first = (4 ** zoom - 1) / 3
    const end = first + 4 ** zoom
    return this.entries.filter((entry) => {
      const runEnd = entry.tileId + Math.max(entry.runLength, 1)
      return entry.tileId < end && runEnd > first
    })
  }

  /** The decompressed bytes of an entry, whatever tile of its run you meant. */
  bytesOf(entry: TileEntry): Buffer {
    return this.read(entry)
  }

  /** The decompressed MVT bytes for one tile, or null if the archive has none. */
  tile(z: number, x: number, y: number): Buffer | null {
    const wanted = zxyToTileId(z, x, y)
    let lo = 0
    let hi = this.entries.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const entry = this.entries[mid]
      if (entry.tileId > wanted) hi = mid - 1
      else if (entry.tileId + Math.max(entry.runLength, 1) <= wanted) lo = mid + 1
      else return this.read(entry)
    }
    return null
  }

  private read(entry: TileEntry): Buffer {
    const buf = Buffer.alloc(entry.length)
    readSync(this.fd, buf, 0, entry.length, this.header.tileDataOffset + entry.offset)
    return decompress(buf, this.header.tileCompression)
  }

  close(): void {
    closeSync(this.fd)
  }
}

/** MVT geometry type code for a polygon. Points and lines cannot own a place. */
const POLYGON = 3

/** One boundary as the tiles carry it. Attribute names are the tippecanoe ones. */
export interface TileFeature {
  name: string
  subjectTo: string
  /** First year the row is valid for. */
  validFrom: number
  /** End-exclusive, like the `int4range` it came from. */
  validTo: number
  confidence: number
  /**
   * Lng/lat, and **clipped to the tile it was read from**, so a polity wider
   * than one tile arrives as several features. Reassembling it is the caller's
   * business; tippecanoe's edge buffer means a union closes the seams.
   */
  geometry: Polygon | MultiPolygon
}

/** A lng/lat rectangle. `north`/`south` are latitudes, so north is the larger. */
export interface BBox {
  west: number
  south: number
  east: number
  north: number
}

/**
 * The tile at `zoom` whose extent covers a point. Web Mercator, y from north.
 *
 * `Math.floor` on the fractional tile, which puts a point exactly on a tile
 * edge in the tile to its east or south. Either neighbour would be defensible
 * and no caller here sits on an edge.
 */
export function tileOf(lng: number, lat: number, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom
  const phi = (lat * Math.PI) / 180
  const y = (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2
  return {
    x: Math.floor(((lng + 180) / 360) * scale),
    y: Math.floor(y * scale),
  }
}

/** Ray casting. Points on the ring itself are undefined, deliberately. */
function inRing(ring: Position[], lng: number, lat: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Containment, in lng/lat, with holes honoured.
 *
 * `toGeoJSON` has already applied the winding rules, so ring 0 of each polygon
 * is the exterior and the rest are its holes. Testing every ring as one
 * even-odd set instead would put Lesotho inside South Africa.
 */
function contains(geometry: Polygon | MultiPolygon, lng: number, lat: number): boolean {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.some(([exterior, ...holes]) =>
    inRing(exterior, lng, lat) && !holes.some((hole) => inRing(hole, lng, lat)))
}

/**
 * The polygons in one tile, in lng/lat.
 *
 * `toGeoJSON` un-quantises the tile's integer grid using the tile envelope and
 * the layer extent, so everything downstream sees the same rounding a client
 * does rather than the unsimplified geometry the database holds. That is the
 * entire point of reading the archive instead of the table.
 */
function polygonsIn(archive: TileArchive, z: number, x: number, y: number): TileFeature[] {
  const bytes = archive.tile(z, x, y)
  if (bytes === null) return []

  const layer = new VectorTile(new PbfReader(bytes)).layers.borders
  if (!layer) return []

  const found: TileFeature[] = []
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i)
    if (feature.type !== POLYGON) continue
    const { geometry } = feature.toGeoJSON(x, y, z)
    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue

    const props = feature.properties
    found.push({
      name: String(props.name ?? ''),
      subjectTo: String(props.subject_to ?? ''),
      validFrom: Number(props.valid_from),
      validTo: Number(props.valid_to),
      confidence: Number(props.confidence),
      geometry,
    })
  }
  return found
}

/**
 * Every boundary the archive draws over a point, at one zoom.
 *
 * Order is the layer's, and no ranking is implied. The database can rank
 * overlapping polities by area and call the smallest the owner; that is
 * meaningless here, because a tile has clipped every feature to its own edges
 * and the areas are of the fragments, not of the polities.
 */
export function featuresAt(
  archive: TileArchive, lng: number, lat: number, zoom: number,
): TileFeature[] {
  const { x, y } = tileOf(lng, lat, zoom)
  return polygonsIn(archive, zoom, x, y)
    .filter((feature) => contains(feature.geometry, lng, lat))
}

/**
 * Every boundary in every tile that covers a rectangle, at one zoom.
 *
 * Whole tiles, not the rectangle: a feature is returned if its tile overlaps
 * `box`, even where the feature itself does not, because clipping it again
 * here would only hide the seams a caller has to close anyway.
 */
export function featuresIn(archive: TileArchive, zoom: number, box: BBox): TileFeature[] {
  const topLeft = tileOf(box.west, box.north, zoom)
  const bottomRight = tileOf(box.east, box.south, zoom)

  const found: TileFeature[] = []
  for (let x = topLeft.x; x <= bottomRight.x; x++) {
    for (let y = topLeft.y; y <= bottomRight.y; y++) {
      found.push(...polygonsIn(archive, zoom, x, y))
    }
  }
  return found
}
