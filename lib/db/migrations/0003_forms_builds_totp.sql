CREATE TABLE IF NOT EXISTS "form_submissions" (
  "id"            SERIAL PRIMARY KEY,
  "site_id"       INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "form_name"     TEXT    NOT NULL DEFAULT 'contact',
  "data"          JSONB   NOT NULL,
  "ip_hash"       TEXT,
  "user_agent"    TEXT,
  "spam_score"    REAL    NOT NULL DEFAULT 0,
  "flagged"       INTEGER NOT NULL DEFAULT 0,
  "read"          INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "form_submissions_site_idx"    ON "form_submissions"("site_id");
CREATE INDEX IF NOT EXISTS "form_submissions_created_idx" ON "form_submissions"("site_id", "created_at" DESC);

DO $$ BEGIN
  CREATE TYPE "build_status" AS ENUM('queued', 'running', 'success', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "build_jobs" (
  "id"            SERIAL PRIMARY KEY,
  "site_id"       INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "triggered_by"  TEXT    NOT NULL REFERENCES "users"("id"),
  "git_url"       TEXT,
  "git_branch"    TEXT    NOT NULL DEFAULT 'main',
  "build_command" TEXT    NOT NULL DEFAULT 'npm run build',
  "output_dir"    TEXT    NOT NULL DEFAULT 'dist',
  "status"        "build_status" NOT NULL DEFAULT 'queued',
  "log"           TEXT,
  "started_at"    TIMESTAMP WITH TIME ZONE,
  "finished_at"   TIMESTAMP WITH TIME ZONE,
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "build_jobs_site_idx"   ON "build_jobs"("site_id");
CREATE INDEX IF NOT EXISTS "build_jobs_status_idx" ON "build_jobs"("status");

ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "preview_url" TEXT;

CREATE TABLE IF NOT EXISTS "totp_credentials" (
  "id"           SERIAL PRIMARY KEY,
  "user_id"      TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "secret"       TEXT NOT NULL,
  "backup_codes" JSONB NOT NULL DEFAULT '[]',
  "enabled_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
