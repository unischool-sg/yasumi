CREATE TABLE "flag_defs" (
	"name" varchar(50) PRIMARY KEY NOT NULL,
	"color" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_flags" (
	"user_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_flags_user_id_name_pk" PRIMARY KEY("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gclid" varchar(200);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gclid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gclid_converted_at" timestamp with time zone;