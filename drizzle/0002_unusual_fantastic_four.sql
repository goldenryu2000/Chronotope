CREATE TABLE "tour_stops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"pack_id" uuid NOT NULL,
	"entity_id" uuid,
	"year" integer NOT NULL,
	"camera" jsonb,
	"title" text NOT NULL,
	"location_label" text NOT NULL,
	"narration" text NOT NULL,
	"layers" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "tour_stops_ordinal_positive" CHECK ("tour_stops"."ordinal" > 0)
);
--> statement-breakpoint
CREATE TABLE "tour_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tour_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"artifact_key" text NOT NULL,
	"artifact_hash" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "tours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"region_id" uuid NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"description" text NOT NULL,
	"estimated_minutes" smallint NOT NULL,
	"owner_id" uuid,
	"visibility" text DEFAULT 'community' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tours_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" ADD CONSTRAINT "tour_stops_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_versions" ADD CONSTRAINT "tour_versions_tour_id_tours_id_fk" FOREIGN KEY ("tour_id") REFERENCES "public"."tours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_versions" ADD CONSTRAINT "tour_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tours" ADD CONSTRAINT "tours_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stop_ordinal_per_tour" ON "tour_stops" USING btree ("tour_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "tour_version_unique" ON "tour_versions" USING btree ("tour_id","version");--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_slug_not_reserved" CHECK ("packs"."slug" <> 'tours');