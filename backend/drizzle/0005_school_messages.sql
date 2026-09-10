CREATE TABLE "school_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"teacher_id" uuid NOT NULL,
	"category" varchar(20) NOT NULL,
	"text" text NOT NULL,
	"total" integer NOT NULL,
	"sent" integer NOT NULL,
	"failed" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
