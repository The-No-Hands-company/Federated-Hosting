CREATE TABLE IF NOT EXISTS "email_queue" (
  "id"           SERIAL PRIMARY KEY,
  "to"           TEXT NOT NULL,
  "subject"      TEXT NOT NULL,
  "html"         TEXT NOT NULL,
  "text"         TEXT NOT NULL,
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "next_attempt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "sent_at"      TIMESTAMP WITH TIME ZONE,
  "created_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "email_queue_pending_idx" ON "email_queue"("next_attempt") WHERE "sent_at" IS NULL;

CREATE TABLE IF NOT EXISTS "site_health_checks" (
  "id"          SERIAL PRIMARY KEY,
  "site_id"     INTEGER NOT NULL,
  "status"      TEXT    NOT NULL,
  "http_status" INTEGER,
  "response_ms" INTEGER,
  "error"       TEXT,
  "checked_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "health_checks_site_idx" ON "site_health_checks"("site_id", "checked_at");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id"          SERIAL PRIMARY KEY,
  "webhook_id"  INTEGER NOT NULL REFERENCES "webhooks"("id") ON DELETE CASCADE,
  "event"       TEXT    NOT NULL,
  "payload"     JSONB   NOT NULL,
  "status_code" INTEGER,
  "response"    TEXT,
  "attempt"     INTEGER NOT NULL DEFAULT 1,
  "duration_ms" INTEGER,
  "success"     INTEGER NOT NULL DEFAULT 0,
  "next_retry"  TIMESTAMP WITH TIME ZONE,
  "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_idx" ON "webhook_deliveries"("webhook_id");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_retry_idx"   ON "webhook_deliveries"("next_retry") WHERE "success" = 0 AND "attempt" < 6;
