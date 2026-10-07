ALTER TABLE "notifications" ADD COLUMN "channel" varchar(10);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "message_text" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "error" text;