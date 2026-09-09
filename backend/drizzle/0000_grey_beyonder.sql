CREATE TABLE "areas" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"prefecture" varchar(50) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"line_user_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_accounts_line_user_id_unique" UNIQUE("line_user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"target_date" date NOT NULL,
	"status" varchar(50) NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "notifications_unique" UNIQUE("user_id","school_id","rule_id","target_date")
);
--> statement-breakpoint
CREATE TABLE "school_areas" (
	"school_id" uuid NOT NULL,
	"area_code" varchar(32) NOT NULL,
	CONSTRAINT "school_areas_school_id_area_code_pk" PRIMARY KEY("school_id","area_code")
);
--> statement-breakpoint
CREATE TABLE "school_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"check_time" time NOT NULL,
	"result" varchar(50) NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_warning_types" (
	"school_id" uuid NOT NULL,
	"warning_type" varchar(100) NOT NULL,
	CONSTRAINT "school_warning_types_school_id_warning_type_pk" PRIMARY KEY("school_id","warning_type")
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"prefecture" varchar(50) NOT NULL,
	"city" varchar(100),
	"website_url" text,
	"rules_url" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"notification_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_school_id_pk" PRIMARY KEY("user_id","school_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warning_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"school_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"target_date" date NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"warning_active" boolean NOT NULL,
	"result" varchar(50) NOT NULL,
	"raw_data" jsonb,
	CONSTRAINT "warning_checks_unique" UNIQUE("school_id","rule_id","target_date")
);
