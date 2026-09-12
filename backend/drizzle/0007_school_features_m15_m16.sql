CREATE TABLE "closure_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"target_date" date NOT NULL,
	"result" varchar(50) NOT NULL,
	"text" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "closure_drafts_unique" UNIQUE("school_id","target_date")
);
--> statement-breakpoint
CREATE TABLE "message_confirmations" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_confirmations_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"title" varchar(100) NOT NULL,
	"category" varchar(20) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "school_messages" ADD COLUMN "require_confirmation" boolean DEFAULT false NOT NULL;