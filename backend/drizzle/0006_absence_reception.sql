CREATE TABLE "absence_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"student_profile_id" uuid NOT NULL,
	"reported_by_user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" varchar(20) NOT NULL,
	"reason" text,
	"note" text,
	"warning_active" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'unread' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"student_name" varchar(100) NOT NULL,
	"grade" varchar(20),
	"class_name" varchar(20),
	"link_token" varchar(64),
	"linked_student_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
