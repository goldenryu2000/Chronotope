CREATE TABLE "tour_stop_layers" (
	"stop_id" uuid NOT NULL,
	"layer_id" uuid NOT NULL,
	CONSTRAINT "tour_stop_layers_stop_id_layer_id_pk" PRIMARY KEY("stop_id","layer_id")
);
--> statement-breakpoint
ALTER TABLE "tour_stop_layers" ADD CONSTRAINT "tour_stop_layers_stop_id_tour_stops_id_fk" FOREIGN KEY ("stop_id") REFERENCES "public"."tour_stops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stop_layers" ADD CONSTRAINT "tour_stop_layers_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_stops" DROP COLUMN "layers";