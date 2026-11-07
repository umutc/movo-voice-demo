CREATE TABLE "demo_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "demo_usage_created_idx" ON "demo_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "demo_usage_ip_created_idx" ON "demo_usage" USING btree ("ip_hash","created_at");