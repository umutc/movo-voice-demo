CREATE TABLE "provider_spend" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid,
	"provider" text NOT NULL,
	"month" text NOT NULL,
	"usd" double precision NOT NULL,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_spend" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_spend" ADD CONSTRAINT "provider_spend_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_spend_call_provider_unique" ON "provider_spend" USING btree ("call_id","provider");--> statement-breakpoint
CREATE INDEX "provider_spend_month_idx" ON "provider_spend" USING btree ("provider","month");