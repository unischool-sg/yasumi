CREATE TABLE "flow_run_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"template_name" varchar(100) NOT NULL,
	"trigger" varchar(20) NOT NULL,
	"schedule_id" uuid,
	"audience_count" integer DEFAULT 0 NOT NULL,
	"results" jsonb NOT NULL,
	"status" varchar(20) NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "flow_run_logs_created_at_idx" ON "flow_run_logs" USING btree ("created_at");