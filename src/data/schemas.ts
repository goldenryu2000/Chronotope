import { z } from 'zod'
import { LAYER_SLOTS } from '../theme/layerSlots'
import { LicenceSchema } from './licences'

/**
 * Zod 4 decides whether to compile parsers by calling `Function("")` once. It
 * catches the failure, but the browser still reports a `script-src` violation
 * under the production CSP, which refuses eval (see next.config.ts). Every
 * schema in the app is declared in this file, so this is the one place to
 * turn the probe off. Interpreted parsing is fast enough for these payloads.
 */
z.config({ jitless: true })

/**
 * Plain signed years: -384 is 384 BCE, 1650 is 1650 CE. There is no year 0.
 * See src/lib/year.ts for why this rather than astronomical numbering.
 */
const Year = z.number().int().min(-4000).max(2200)

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const Slug = z.string().regex(SLUG_PATTERN, 'must be lowercase kebab-case')

/**
 * Whether a URL segment could name anything at all.
 *
 * Routes check this before querying. A request for `/World/x` or
 * `/aaaa…/x` can match no row, and answering it from Postgres costs Neon compute
 * that anyone can spend in a loop. 64 is well above the longest slug in the
 * content (24).
 */
export function isSlug(value: string): boolean {
  return value.length <= 64 && SLUG_PATTERN.test(value)
}

export const EntitySchema = z
  .object({
    id: Slug,
    name: z.string().min(1),
    /**
     * The years this entity is on the map, and what that means is the pack's
     * business — see `spanLabel` on the manifest.
     *
     * Named start/end rather than birth/death because those are person-shaped
     * and only one pack is about people. A creature has no birthday, and Zeus
     * was not born in 1400 BCE; that is simply the earliest surviving tablet
     * that names him. Encoding an attestation window in a field called `birth`
     * would quietly assert something false.
     */
    start: Year,
    end: Year,
    /** Dates are estimates; the map renders these with a softer marker. */
    fuzzy: z.boolean().optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    place: z.string().min(1),
    traditions: z.array(Slug).min(1),
    tier: z.enum(['core', 'halo']),
    blurb: z.string().min(20).max(400),
    ideas: z.array(z.string().min(1)).default([]),
    /** Rendered as a link. https Wikipedia only, so no `javascript:` or look-alike host can ride in on content. */
    wikipedia: z.url({ protocol: /^https$/, hostname: /^([a-z-]+\.)?wikipedia\.org$/ }),
    wikidata: z.string().regex(/^Q\d+$/),
    /**
     * A depiction, not a likeness. The bust of Socrates is a Roman copy of a
     * lost Greek original; a dragon is somebody's drawing. Credit and licence
     * travel with the file because most of these are not public domain.
     */
    image: z
      .object({
        /** A bare filename. It becomes a path under /images/<pack>/. */
        file: z.string().regex(/^[A-Za-z0-9._-]+$/),
        credit: z.string().min(1),
        licence: LicenceSchema,
        /** The file's page, linked from the caption. Attribution licences require it. */
        source: z.url({ protocol: /^https$/, hostname: z.regexes.domain }),
      })
      .optional(),
  })
  .refine((e) => e.end >= e.start, {
    message: 'end must not precede start',
    path: ['end'],
  })

export const EraSchema = z
  .object({
    id: Slug,
    label: z.string().min(1),
    start: Year,
    end: Year,
    /** Share of the timeline track this era occupies, relative to other eras. */
    weight: z.number().positive(),
    blurb: z.string().min(20).max(500),
  })
  .refine((e) => e.end > e.start, {
    message: 'end must be after start',
    path: ['end'],
  })

export const TraditionSchema = z.object({
  id: Slug,
  label: z.string().min(1),
  /** Where the tradition sits, as prose. Not a reference to a `regions` row. */
  regionLabel: z.string().min(1),
})

export const RegionSchema = z
  .object({
    id: Slug,
    title: z.string().min(1),
    subtitle: z.string().min(1),
    /** [west, south, east, north] */
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    minZoom: z.number().int().min(0).max(22),
    maxZoom: z.number().int().min(0).max(22),
    defaultCamera: z.object({
      center: z.tuple([z.number(), z.number()]),
      zoom: z.number(),
      bearing: z.number().optional(),
      pitch: z.number().optional(),
    }),
    /** The outer temporal bound. A pack narrows within it; it never widens. */
    range: z.object({ start: Year, end: Year }),
    theme: z.string().min(1),
    tilesetKey: z.string().optional(),
    /**
     * The years this region's boundaries cover, `last` inclusive. Absent until
     * boundaries have been imported. The client clamps the year it filters on
     * to this, so a year outside the corpus draws the nearest map that exists
     * rather than an empty one.
     */
    borderYears: z.object({ first: Year, last: Year }).optional(),
    /** The region's default periodization. A pack may override it. */
    eras: z.array(EraSchema),
  })
  .refine((r) => r.bbox[0] < r.bbox[2], {
    message: 'bbox west must be less than east',
    path: ['bbox'],
  })
  .refine((r) => r.bbox[1] < r.bbox[3], {
    message: 'bbox south must be less than north',
    path: ['bbox'],
  })
  .refine((r) => r.maxZoom >= r.minZoom, {
    message: 'maxZoom must not be below minZoom',
    path: ['maxZoom'],
  })

export const PackSchema = z.object({
  id: Slug,
  title: z.string().min(1),
  subtitle: z.string().min(1),
  /** What a span means here: "lived" for philosophy, "attested" for the myth packs. */
  spanLabel: z.string().min(1),
  /** Years to delay a pin past `start`, so a newborn Aristotle is not on the map. */
  activeOffset: z.number().int().min(0).default(0),
  range: z.object({ start: Year, end: Year }),
  startYear: Year,
  traditions: z.array(TraditionSchema),
  entities: z.array(EntitySchema),
  /** Era sets that replace the region's default, keyed by region slug. */
  eraOverrides: z.record(z.string(), z.array(EraSchema)).default({}),
})

export type Entity = z.infer<typeof EntitySchema>
export type Era = z.infer<typeof EraSchema>
export type Tradition = z.infer<typeof TraditionSchema>
export type Region = z.infer<typeof RegionSchema>
export type Pack = z.infer<typeof PackSchema>

/**
 * Where the camera goes, and nothing else.
 *
 * Deliberately not `RegionSchema.defaultCamera`, which also carries bearing and
 * pitch: the map is built with `dragRotate: false` and `pitchWithRotate: false`,
 * so a view that could tilt would be offering something the atlas will not do.
 */
export const CameraSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number().min(0).max(22),
})

/**
 * One state of the atlas, and the only thing allowed to move it.
 *
 * A tour stop is a view with prose attached. So is a search result, so is a
 * shared link, and so is whatever a reader eventually authors themselves. The
 * ported build had no such type and spent a comment saying that travelling to a
 * search result "reuses the tour-stop path exactly", which is a comment doing a
 * type's job.
 *
 * `camera: null` means leave the camera where the reader put it; `entityId:
 * null` means this view is about a place rather than a person, which is a stop
 * a layer can carry on its own once layers exist.
 */
export const AtlasViewSchema = z.object({
  pack: Slug,
  year: Year,
  entityId: Slug.nullable().default(null),
  camera: CameraSchema.nullable().default(null),
  /**
   * Layer slugs lit for this view, replacing whatever the reader had lit: a
   * view describes the atlas completely. Empty means the stop puts every
   * layer out, not that it leaves them alone.
   */
  layers: z.array(Slug).default([]),
})

export const TourStopSchema = AtlasViewSchema.extend({
  title: z.string().min(1),
  locationLabel: z.string().min(1),
  narration: z.string().min(20).max(1200),
})

export const TourSchema = z.object({
  id: Slug,
  regionSlug: Slug,
  title: z.string().min(1),
  subtitle: z.string().min(1),
  description: z.string().min(20).max(800),
  estimatedMinutes: z.number().int().positive(),
  stops: z.array(TourStopSchema).min(1),
})

export type Camera = z.infer<typeof CameraSchema>
export type AtlasView = z.infer<typeof AtlasViewSchema>
export type TourStop = z.infer<typeof TourStopSchema>
export type Tour = z.infer<typeof TourSchema>

/**
 * What kind of thing moved along the line.
 *
 * Worth distinguishing rather than calling everything a route: the Silk Road
 * carried goods with people walking beside them, the alphabet carried nothing
 * at all, and the Atlantic passage carried people who had not agreed to go.
 * The kind sets the dash pattern, which is what keeps two lit layers of
 * similar hue tellable apart.
 */
export const LAYER_KINDS = ['trade', 'idea', 'migration'] as const

export const LayerKindSchema = z.enum(LAYER_KINDS)

/**
 * A GeoJSON FeatureCollection, checked only as far as the map needs.
 *
 * Deliberately looser than the geometry column, which is `MultiLineString`
 * today: a published layer is a document the browser hands to MapLibre, and
 * MapLibre draws points and polygons too. Narrowing the table and leaving the
 * document general is what makes territorial extents later a migration rather
 * than a change to the contract every reader's browser parses.
 */
const FeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z
    .array(
      z.object({
        type: z.literal('Feature'),
        properties: z.record(z.string(), z.unknown()).nullable(),
        geometry: z.object({ type: z.string(), coordinates: z.unknown() }),
      }),
    )
    // A layer with no features is a menu entry that lights an empty map, which
    // is the failure `EmptyState` exists to prevent elsewhere.
    .min(1),
})

export const LayerSchema = z
  .object({
    id: Slug,
    name: z.string().min(1),
    kind: LayerKindSchema,
    /**
     * Which colour, as a slot in the theme palette rather than a colour or a
     * token name. See src/theme/layerSlots.ts for why this is an integer.
     */
    paletteSlot: z.number().int().min(1).max(LAYER_SLOTS),
    /** Inclusive at both ends, like every other artifact range. */
    valid: z.object({ start: Year, end: Year }),
    /** One line of context, shown under the name in the layer menu. */
    note: z.string().min(1),
    features: FeatureCollectionSchema,
  })
  .refine((layer) => layer.valid.end >= layer.valid.start, {
    message: 'valid end must not precede start',
    path: ['valid', 'end'],
  })

export type LayerKind = z.infer<typeof LayerKindSchema>
export type Layer = z.infer<typeof LayerSchema>
