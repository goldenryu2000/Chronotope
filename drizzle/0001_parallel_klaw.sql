DROP INDEX "one_era_set_per_pair";--> statement-breakpoint
ALTER TABLE "era_sets" ADD CONSTRAINT "one_era_set_per_pair" UNIQUE NULLS NOT DISTINCT("region_id","pack_id");--> statement-breakpoint
ALTER TABLE "boundaries" ADD CONSTRAINT "boundaries_valid_not_empty" CHECK (not isempty("boundaries"."valid"));--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_span_not_empty" CHECK (not isempty("entities"."span"));--> statement-breakpoint
ALTER TABLE "packs" ADD CONSTRAINT "packs_range_not_empty" CHECK (not isempty("packs"."range"));--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_range_not_empty" CHECK (not isempty("regions"."range"));