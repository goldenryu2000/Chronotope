CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TABLE "boundaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"geom" geometry(MultiPolygon,4326) NOT NULL,
	"valid" "int4range" NOT NULL,
	"admin_level" smallint DEFAULT 2 NOT NULL,
	"source" text NOT NULL,
	"confidence" text DEFAULT 'high' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"span" "int4range" NOT NULL,
	"fuzzy" boolean DEFAULT false NOT NULL,
	"point" geometry(Point,4326) NOT NULL,
	"place" text NOT NULL,
	"tier" text DEFAULT 'core' NOT NULL,
	"blurb" text NOT NULL,
	"ideas" text[] DEFAULT '{}' NOT NULL,
	"wikipedia" text NOT NULL,
	"wikidata" text NOT NULL,
	"image" jsonb
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "entity_traditions" (
	"entity_id" uuid NOT NULL,
	"tradition_id" uuid NOT NULL,
	CONSTRAINT "entity_traditions_entity_id_tradition_id_pk" PRIMARY KEY("entity_id","tradition_id")
);
--> statement-breakpoint
CREATE TABLE "era_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"pack_id" uuid
);
--> statement-breakpoint
CREATE TABLE "eras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"era_set_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"start" integer NOT NULL,
	"end" integer NOT NULL,
	"weight" integer NOT NULL,
	"blurb" text NOT NULL,
	"ordinal" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"artifact_key" text NOT NULL,
	"artifact_hash" text NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	"published_by" uuid
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"span_label" text NOT NULL,
	"active_offset" integer DEFAULT 0 NOT NULL,
	"range" "int4range" NOT NULL,
	"start_year" integer NOT NULL,
	"owner_id" uuid,
	"visibility" text DEFAULT 'community' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "packs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"bbox" geometry(Polygon,4326) NOT NULL,
	"min_zoom" smallint DEFAULT 0 NOT NULL,
	"max_zoom" smallint DEFAULT 6 NOT NULL,
	"default_camera" jsonb NOT NULL,
	"range" "int4range" NOT NULL,
	"tileset_key" text,
	"current_artifact_key" text,
	"theme" text DEFAULT 'rustic' NOT NULL,
	"owner_id" uuid,
	"visibility" text DEFAULT 'community' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "traditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"region_label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_auth_id" text,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_external_auth_id_unique" UNIQUE("external_auth_id"),
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_traditions" ADD CONSTRAINT "entity_traditions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_traditions" ADD CONSTRAINT "entity_traditions_tradition_id_traditions_id_fk" FOREIGN KEY ("tradition_id") REFERENCES "public"."traditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "era_sets" ADD CONSTRAINT "era_sets_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "era_sets" ADD CONSTRAINT "era_sets_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eras" ADD CONSTRAINT "eras_era_set_id_era_sets_id_fk" FOREIGN KEY ("era_set_id") REFERENCES "public"."era_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD CONSTRAINT "pack_versions_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_versions" ADD CONSTRAINT "pack_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traditions" ADD CONSTRAINT "traditions_pack_id_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boundaries_geom_idx" ON "boundaries" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "boundaries_valid_idx" ON "boundaries" USING gist ("valid");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_slug_per_pack" ON "entities" USING btree ("pack_id","slug");--> statement-breakpoint
CREATE INDEX "entities_point_idx" ON "entities" USING gist ("point");--> statement-breakpoint
CREATE INDEX "entities_span_idx" ON "entities" USING gist ("span");--> statement-breakpoint
CREATE INDEX "entitlements_user_idx" ON "entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_era_set_per_pair" ON "era_sets" USING btree ("region_id","pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_version_unique" ON "pack_versions" USING btree ("pack_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "tradition_slug_per_pack" ON "traditions" USING btree ("pack_id","slug");