CREATE TABLE "flow_event_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"audience_mode" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flow_run_logs" ADD COLUMN "event_type" varchar(40);