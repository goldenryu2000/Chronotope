ALTER TABLE "regions" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_id_regions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "regions_parent_idx" ON "regions" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_parent_not_self" CHECK ("regions"."parent_id" is distinct from "regions"."id");