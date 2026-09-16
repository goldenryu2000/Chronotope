import { customType } from 'drizzle-orm/pg-core'

/**
 * Postgres `int4range`, exposed as an inclusive-exclusive `[lo, hi)` tuple.
 *
 * Postgres canonicalises every non-empty int4range to `[lo,hi)` on write, so
 * the parse below only ever sees that one form — plus the literal `empty`,
 * which is what a degenerate range like `[2020,2020)` collapses to. Empty
 * ranges are rejected at the column level by the `*_not_empty` check
 * constraints (see schema.ts) rather than being modelled as null, so a column
 * declared with this type cannot yield `empty` on read; the branch below only
 * catches raw SQL that bypasses those columns, and names the usual cause.
 */
export const int4range = customType<{ data: [number, number]; driverData: string }>({
  dataType: () => 'int4range',
  toDriver: ([lo, hi]) => `[${lo},${hi})`,
  fromDriver: (value) => {
    if (value === 'empty') {
      throw new Error(
        'empty int4range from postgres: a range is [lo,hi) with hi exclusive, so a ' +
          'last-inclusive year Y must be stored as Y+1. [Y,Y) collapses to empty.',
      )
    }
    const match = /^\[(-?\d+),(-?\d+)\)$/.exec(value)
    if (!match) throw new Error(`unexpected int4range from postgres: ${value}`)
    return [Number(match[1]), Number(match[2])]
  },
})

/**
 * PostGIS geometry. EWKT on the way *in* only.
 *
 * Writes accept EWKT (`SRID=4326;POLYGON(...)`), which Postgres parses on
 * assignment. Reads are asymmetric: postgres-js does not know the geometry
 * OID, so it returns the type's text output, which is hex EWKB
 * (`0103000020E6100000...`), not EWKT. Drizzle's `customType` can transform a
 * value but cannot wrap the SELECT expression, so there is no `fromDriver`
 * that could undo this without shipping a WKB parser.
 *
 * Callers that need readable geometry must ask for it explicitly:
 * `sql`ST_AsEWKT(${regions.bbox})`` or `ST_AsGeoJSON(...)`. Selecting the
 * column bare gives you hex EWKB typed as `string`.
 */
export const geometry = (
  name: string,
  type: 'Point' | 'Polygon' | 'MultiPolygon' | 'MultiLineString',
) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => `geometry(${type},4326)`,
  })(name)
