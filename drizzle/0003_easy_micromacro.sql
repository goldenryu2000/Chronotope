CREATE TABLE "layer_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"geom" geometry(MultiLineString,4326) NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"palette_slot" smallint NOT NULL,
	"valid" "int4range" NOT NULL,
	"note" text NOT NULL,
	"owner_id" uuid,
	"visibility" text DEFAULT 'community' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_artifact_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "layers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "layers_valid_not_empty" CHECK (not isempty("layers"."valid")),
	CONSTRAINT "layers_palette_slot_in_range" CHECK ("layers"."palette_slot" between 1 and 9)
);
--> statement-breakpoint
ALTER TABLE "layer_features" ADD CONSTRAINT "layer_features_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layer_features_geom_idx" ON "layer_features" USING gist ("geom");