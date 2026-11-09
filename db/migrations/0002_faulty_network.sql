CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "demo_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_state_single_row" CHECK ("demo_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "demo_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "alerts_kind_sent_idx" ON "alerts" USING btree ("kind","sent_at");