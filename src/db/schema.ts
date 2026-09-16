import { relations, sql } from 'drizzle-orm'
import {
  boolean, check, index, integer, jsonb, pgTable, primaryKey, smallint,
  text, timestamp, unique, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core'
import { geometry, int4range } from './types'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalAuthId: text('external_auth_id').unique(),
  handle: text('handle').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const regions = pgTable('regions', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull(),
  bbox: geometry('bbox', 'Polygon').notNull(),
  minZoom: smallint('min_zoom').notNull().default(0),
  maxZoom: smallint('max_zoom').notNull().default(6),
  defaultCamera: jsonb('default_camera').$type<{
    center: [number, number]; zoom: number; bearing?: number; pitch?: number
  }>().notNull(),
  range: int4range('range').notNull(),
  tilesetKey: text('tileset_key'),
  /**
   * Regions get a pointer, not a version table. They are not user-editable
   * until M3, so the full pack_versions treatment would be unused machinery.
   * Promote it when regions become authorable.
   */
  currentArtifactKey: text('current_artifact_key'),
  theme: text('theme').notNull().default('rustic'),
  ownerId: uuid('owner_id').references(() => users.id),
  visibility: text('visibility', { enum: ['official', 'community'] }).notNull().default('community'),
  status: text('status', { enum: ['draft', 'in_review', 'published', 'unlisted'] })
    .notNull().default('draft'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [check('regions_range_not_empty', sql`not isempty(${t.range})`)])

/**
 * Global historical geometry. Deliberately has no region_id: a region is a
 * view onto this table produced by clipping to its bbox at tile-build time.
 * France must not exist twice because it appears in both Europe and the world.
 */
export const boundaries = pgTable('boundaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  geom: geometry('geom', 'MultiPolygon').notNull(),
  valid: int4range('valid').notNull(),
  adminLevel: smallint('admin_level').notNull().default(2),
  source: text('source').notNull(),
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull().default('high'),
  properties: jsonb('properties').$type<Record<string, unknown>>().default({}),
}, (t) => [
  index('boundaries_geom_idx').using('gist', t.geom),
  index('boundaries_valid_idx').using('gist', t.valid),
  check('boundaries_valid_not_empty', sql`not isempty(${t.valid})`),
])

/**
 * An overlay the map can light: a trade route, the travel of an idea, a
 * migration.
 *
 * Deliberately has no region_id, for the reason `boundaries` has none. The
 * Silk Road is not owned by a region, and a region is a view onto global
 * geometry produced by clipping to its bbox. Which region offers which layer
 * is computed by intersecting the two, in `src/read/regionLayers.ts`.
 *
 * A bare `current_artifact_key`, not a versions table. Nothing addresses a
 * specific version of a layer: a tour stop names a slug and resolution happens
 * at read time. Tours are the opposite case, which is why they differ.
 *
 * The owner/visibility/status trio is unused while every layer is ours, and is
 * the whole reason this is a table rather than a TypeScript array.
 */
export const layers = pgTable('layers', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['trade', 'idea', 'migration'] }).notNull(),
  /**
   * A slot in the theme palette, never a colour and never a token name. See
   * `src/theme/layerSlots.ts`: Rule 1 says the map's colours come from CSS
   * custom properties, and a user-authored layer cannot ship CSS. The upper
   * bound is duplicated from `LAYER_SLOTS` because a check constraint cannot
   * import TypeScript. `schema.test.ts` holds the two in step, by inserting
   * slot `LAYER_SLOTS` and being refused slot `LAYER_SLOTS + 1`; and
   * `layerSlots.test.ts` holds the themes to the same count.
   */
  paletteSlot: smallint('palette_slot').notNull(),
  valid: int4range('valid').notNull(),
  note: text('note').notNull(),
  ownerId: uuid('owner_id').references(() => users.id),
  visibility: text('visibility', { enum: ['official', 'community'] }).notNull().default('community'),
  status: text('status', { enum: ['draft', 'in_review', 'published', 'unlisted'] })
    .notNull().default('draft'),
  currentArtifactKey: text('current_artifact_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  check('layers_valid_not_empty', sql`not isempty(${t.valid})`),
  check('layers_palette_slot_in_range', sql`${t.paletteSlot} between 1 and 9`),
])

/**
 * One named leg of a layer.
 *
 * A row per leg rather than one geometry per layer, so the Silk Road's
 * northern and southern routes stay separately named. `MultiLineString` rather
 * than `LineString` so the importer never has to branch on how many parts a
 * leg happens to have.
 */
export const layerFeatures = pgTable('layer_features', {
  id: uuid('id').defaultRandom().primaryKey(),
  layerId: uuid('layer_id').notNull().references(() => layers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  geom: geometry('geom', 'MultiLineString').notNull(),
  properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [index('layer_features_geom_idx').using('gist', t.geom)])

export const packs = pgTable('packs', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull(),
  spanLabel: text('span_label').notNull(),
  activeOffset: integer('active_offset').notNull().default(0),
  range: int4range('range').notNull(),
  startYear: integer('start_year').notNull(),
  ownerId: uuid('owner_id').references(() => users.id),
  visibility: text('visibility', { enum: ['official', 'community'] }).notNull().default('community'),
  status: text('status', { enum: ['draft', 'in_review', 'published', 'unlisted'] })
    .notNull().default('draft'),
  currentVersionId: uuid('current_version_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  check('packs_range_not_empty', sql`not isempty(${t.range})`),
  /**
   * `/world/tours/gods-grew-quiet` also matches `/[region]/[pack]/[entity]`
   * with pack "tours". Next resolves static segments ahead of dynamic ones, so
   * the tour route wins, but only for as long as no pack takes that slug. This
   * is that guarantee, held by the database rather than by a convention.
   */
  check('packs_slug_not_reserved', sql`${t.slug} <> 'tours'`),
])

export const packVersions = pgTable('pack_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  packId: uuid('pack_id').notNull().references(() => packs.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  artifactKey: text('artifact_key').notNull(),
  artifactHash: text('artifact_hash').notNull(),
  publishedAt: timestamp('published_at').defaultNow().notNull(),
  publishedBy: uuid('published_by').references(() => users.id),
}, (t) => [uniqueIndex('pack_version_unique').on(t.packId, t.version)])

/**
 * A guided tour: an ordered walk through views of one region's map.
 *
 * `region_id` sits here, unlike on `packs`. A pack is *placed* on a region
 * through `era_sets`, because one pack can sit on several regions with
 * different periodizations. A tour is authored against one region's camera
 * bounds and one region's shape of time, so it belongs rather than being
 * placed.
 *
 * The owner/visibility/status trio is unused while every tour is ours, and is
 * the whole reason this is a table rather than a TypeScript array: a
 * user-authored tour is this row with `owner_id` set.
 */
export const tours = pgTable('tours', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  regionId: uuid('region_id').notNull().references(() => regions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  subtitle: text('subtitle').notNull(),
  description: text('description').notNull(),
  estimatedMinutes: smallint('estimated_minutes').notNull(),
  ownerId: uuid('owner_id').references(() => users.id),
  visibility: text('visibility', { enum: ['official', 'community'] }).notNull().default('community'),
  status: text('status', { enum: ['draft', 'in_review', 'published', 'unlisted'] })
    .notNull().default('draft'),
  currentVersionId: uuid('current_version_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

/**
 * One stop: an `AtlasView` plus the prose read over it.
 *
 * `entity_id` is nullable because a stop about a place rather than a person is
 * legitimate, and becomes more so once layers exist. `pack_id` and `entity_id`
 * are foreign keys, not slugs, which is what makes the ported build's two
 * commonest failures — an entity in no pack, and a misspelled id — unwritable
 * rather than merely untested.
 *
 * Which layers a stop lights is not a column here. See `tourStopLayers`.
 */
export const tourStops = pgTable('tour_stops', {
  id: uuid('id').defaultRandom().primaryKey(),
  tourId: uuid('tour_id').notNull().references(() => tours.id, { onDelete: 'cascade' }),
  ordinal: integer('ordinal').notNull(),
  packId: uuid('pack_id').notNull().references(() => packs.id),
  entityId: uuid('entity_id').references(() => entities.id),
  year: integer('year').notNull(),
  camera: jsonb('camera').$type<{ center: [number, number]; zoom: number } | null>(),
  title: text('title').notNull(),
  locationLabel: text('location_label').notNull(),
  narration: text('narration').notNull(),
}, (t) => [
  uniqueIndex('stop_ordinal_per_tour').on(t.tourId, t.ordinal),
  check('tour_stops_ordinal_positive', sql`${t.ordinal} > 0`),
])

/**
 * Which layers a stop lights.
 *
 * A join table rather than the slug array milestone A carried, which was a
 * slug array only because there was no `layers` table for a key to point at.
 * The same argument that put foreign keys on `pack_id` and `entity_id` applies
 * here: a misspelled layer slug becomes unwritable rather than merely
 * untested, and the ported build's two commonest failures were both of exactly
 * that class.
 *
 * `restrict` on the layer, not `cascade`. A cascade would let deleting a layer
 * silently rewrite a published tour into one whose narration describes a route
 * the reader cannot see. A refusal names the tour that is in the way; a
 * cascade names nothing.
 */
export const tourStopLayers = pgTable('tour_stop_layers', {
  stopId: uuid('stop_id').notNull().references(() => tourStops.id, { onDelete: 'cascade' }),
  layerId: uuid('layer_id').notNull().references(() => layers.id, { onDelete: 'restrict' }),
}, (t) => [
  primaryKey({ columns: [t.stopId, t.layerId] }),
  // The primary key leads with the stop, so it cannot answer "does any stop
  // name this layer?", and Postgres does not index a referencing column on its
  // own. Without this the `restrict` check scans the whole table on every
  // layer delete, which makes the one operation the key exists to guard the
  // slowest thing it does.
  index('tour_stop_layers_layer_idx').on(t.layerId),
])

/**
 * Immutable published versions, exactly as `pack_versions` works.
 *
 * `regions` got a bare pointer instead, with a comment saying to promote it
 * when regions become authorable. Tours are authorable by design, and a link
 * to stop 4 should keep meaning what it meant when it was shared.
 */
export const tourVersions = pgTable('tour_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tourId: uuid('tour_id').notNull().references(() => tours.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  artifactKey: text('artifact_key').notNull(),
  artifactHash: text('artifact_hash').notNull(),
  publishedAt: timestamp('published_at').defaultNow().notNull(),
  publishedBy: uuid('published_by').references(() => users.id),
}, (t) => [uniqueIndex('tour_version_unique').on(t.tourId, t.version)])

export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  packId: uuid('pack_id').notNull().references(() => packs.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  span: int4range('span').notNull(),
  fuzzy: boolean('fuzzy').notNull().default(false),
  point: geometry('point', 'Point').notNull(),
  place: text('place').notNull(),
  tier: text('tier', { enum: ['core', 'halo'] }).notNull().default('core'),
  blurb: text('blurb').notNull(),
  ideas: text('ideas').array().notNull().default([]),
  wikipedia: text('wikipedia').notNull(),
  wikidata: text('wikidata').notNull(),
  image: jsonb('image').$type<{
    file: string; credit: string; licence: string; source: string
  } | null>(),
}, (t) => [
  uniqueIndex('entity_slug_per_pack').on(t.packId, t.slug),
  index('entities_point_idx').using('gist', t.point),
  index('entities_span_idx').using('gist', t.span),
  check('entities_span_not_empty', sql`not isempty(${t.span})`),
])

export const traditions = pgTable('traditions', {
  id: uuid('id').defaultRandom().primaryKey(),
  packId: uuid('pack_id').notNull().references(() => packs.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  regionLabel: text('region_label').notNull(),
}, (t) => [uniqueIndex('tradition_slug_per_pack').on(t.packId, t.slug)])

export const entityTraditions = pgTable('entity_traditions', {
  entityId: uuid('entity_id').notNull().references(() => entities.id, { onDelete: 'cascade' }),
  traditionId: uuid('tradition_id').notNull().references(() => traditions.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.entityId, t.traditionId] })])

/** packId null means this is the region's default periodization. */
export const eraSets = pgTable('era_sets', {
  id: uuid('id').defaultRandom().primaryKey(),
  regionId: uuid('region_id').notNull().references(() => regions.id, { onDelete: 'cascade' }),
  packId: uuid('pack_id').references(() => packs.id, { onDelete: 'cascade' }),
}, (t) => [
  /**
   * NULLS NOT DISTINCT, because the null pack_id row is the primary case, not
   * an edge case: it is the region's default periodization. Under the default
   * NULLS DISTINCT two "one default era set per region" rows both insert, and
   * a reader silently gets whichever periodization the plan returns first.
   */
  unique('one_era_set_per_pair').on(t.regionId, t.packId).nullsNotDistinct(),
])

export const eras = pgTable('eras', {
  id: uuid('id').defaultRandom().primaryKey(),
  eraSetId: uuid('era_set_id').notNull().references(() => eraSets.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  label: text('label').notNull(),
  start: integer('start').notNull(),
  end: integer('end').notNull(),
  weight: integer('weight').notNull(),
  blurb: text('blurb').notNull(),
  ordinal: integer('ordinal').notNull(),
})

export const submissions = pgTable('submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  subjectType: text('subject_type', { enum: ['pack', 'region'] }).notNull(),
  subjectId: uuid('subject_id').notNull(),
  submittedBy: uuid('submitted_by').notNull().references(() => users.id),
  submittedAt: timestamp('submitted_at').defaultNow().notNull(),
  state: text('state', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  reviewerId: uuid('reviewer_id').references(() => users.id),
  notes: text('notes'),
})

/**
 * `source` is nullable and unconstrained on purpose. A grant made by hand, by
 * an admin, or by a future payment gateway all look the same to the reader.
 * Entitlement checks live here, never in a provider's API.
 */
export const entitlements = pgTable('entitlements', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type', { enum: ['pack', 'region'] }).notNull(),
  subjectId: uuid('subject_id').notNull(),
  grantedAt: timestamp('granted_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  source: text('source'),
}, (t) => [index('entitlements_user_idx').on(t.userId)])

export const packRelations = relations(packs, ({ many }) => ({
  entities: many(entities),
  traditions: many(traditions),
  versions: many(packVersions),
}))
