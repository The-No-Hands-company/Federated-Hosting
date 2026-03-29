-- Nexus Hosting — Initial Database Migration
-- Generated: March 2026
-- This migration creates the full schema from scratch.
-- Run with: pnpm --filter @workspace/db run migrate

-- ─── Enums ──────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "node_status" AS ENUM('active', 'inactive', 'maintenance');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "site_status" AS ENUM('active', 'suspended', 'migrating');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "site_type" AS ENUM('static', 'dynamic', 'blog', 'portfolio', 'other', 'nlpl');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "site_visibility" AS ENUM('public', 'private', 'password');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "deployment_status" AS ENUM('pending', 'active', 'failed', 'rolled_back');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "federation_event_type" AS ENUM('handshake', 'ping', 'site_sync', 'node_offline', 'key_rotation');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "domain_verification_status" AS ENUM('pending', 'verified', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "site_member_role" AS ENUM('owner', 'editor', 'viewer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Auth ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "sessions" (
  "sid"    VARCHAR PRIMARY KEY,
  "sess"   JSONB NOT NULL,
  "expire" TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "sessions"("expire");

CREATE TABLE IF NOT EXISTS "users" (
  "id"                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"             VARCHAR UNIQUE,
  "first_name"        VARCHAR,
  "last_name"         VARCHAR,
  "profile_image_url" VARCHAR,
  "is_admin"          INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ─── Nodes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "nodes" (
  "id"                    SERIAL PRIMARY KEY,
  "name"                  TEXT NOT NULL,
  "domain"                TEXT NOT NULL UNIQUE,
  "description"           TEXT,
  "status"                "node_status" NOT NULL DEFAULT 'active',
  "region"                TEXT NOT NULL,
  "operator_name"         TEXT NOT NULL,
  "operator_email"        TEXT NOT NULL,
  "storage_capacity_gb"   REAL NOT NULL,
  "bandwidth_capacity_gb" REAL NOT NULL,
  "uptime_percent"        REAL NOT NULL DEFAULT 100,
  "site_count"            INTEGER NOT NULL DEFAULT 0,
  "public_key"            TEXT,
  "private_key"           TEXT,
  "is_local_node"         INTEGER DEFAULT 0,
  "joined_at"             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "last_seen_at"          TIMESTAMP WITH TIME ZONE,
  "verified_at"           TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS "nodes_status_idx"  ON "nodes"("status");
CREATE INDEX IF NOT EXISTS "nodes_local_idx"   ON "nodes"("is_local_node");

-- ─── Sites ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "sites" (
  "id"                   SERIAL PRIMARY KEY,
  "name"                 TEXT NOT NULL,
  "domain"               TEXT NOT NULL UNIQUE,
  "description"          TEXT,
  "status"               "site_status"     NOT NULL DEFAULT 'active',
  "site_type"            "site_type"       NOT NULL DEFAULT 'static',
  "owner_name"           TEXT NOT NULL,
  "owner_email"          TEXT NOT NULL,
  "owner_id"             TEXT,
  "primary_node_id"      INTEGER,
  "replica_count"        INTEGER NOT NULL DEFAULT 1,
  "storage_used_mb"      REAL NOT NULL DEFAULT 0,
  "monthly_bandwidth_gb" REAL NOT NULL DEFAULT 0,
  "hit_count"            BIGINT NOT NULL DEFAULT 0,
  "last_hit_at"          TIMESTAMP WITH TIME ZONE,
  "visibility"           "site_visibility" NOT NULL DEFAULT 'public',
  "password_hash"        TEXT,
  "created_at"           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "sites_owner_idx"        ON "sites"("owner_id");
CREATE INDEX IF NOT EXISTS "sites_status_idx"       ON "sites"("status");
CREATE INDEX IF NOT EXISTS "sites_primary_node_idx" ON "sites"("primary_node_id");

-- ─── Deployments ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "site_deployments" (
  "id"             SERIAL PRIMARY KEY,
  "site_id"        INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "version"        INTEGER NOT NULL DEFAULT 1,
  "deployed_by"    TEXT,
  "status"         "deployment_status" NOT NULL DEFAULT 'pending',
  "file_count"     INTEGER NOT NULL DEFAULT 0,
  "total_size_mb"  REAL NOT NULL DEFAULT 0,
  "deployed_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "site_deployments_site_idx"   ON "site_deployments"("site_id");
CREATE INDEX IF NOT EXISTS "site_deployments_status_idx" ON "site_deployments"("status");

CREATE TABLE IF NOT EXISTS "site_files" (
  "id"            SERIAL PRIMARY KEY,
  "site_id"       INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "deployment_id" INTEGER,
  "file_path"     TEXT NOT NULL,
  "object_path"   TEXT NOT NULL,
  "content_type"  TEXT NOT NULL DEFAULT 'application/octet-stream',
  "size_bytes"    INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "site_files_site_idx"       ON "site_files"("site_id");
CREATE INDEX IF NOT EXISTS "site_files_path_idx"       ON "site_files"("site_id", "file_path");
CREATE INDEX IF NOT EXISTS "site_files_deployment_idx" ON "site_files"("deployment_id");

-- ─── Federation ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "federation_events" (
  "id"                SERIAL PRIMARY KEY,
  "event_type"        "federation_event_type" NOT NULL,
  "from_node_domain"  TEXT,
  "to_node_domain"    TEXT,
  "payload"           TEXT,
  "verified"          INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "federation_events_type_idx"    ON "federation_events"("event_type");
CREATE INDEX IF NOT EXISTS "federation_events_from_idx"    ON "federation_events"("from_node_domain");
CREATE INDEX IF NOT EXISTS "federation_events_created_idx" ON "federation_events"("created_at");

-- ─── Analytics ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "site_analytics" (
  "id"             SERIAL PRIMARY KEY,
  "site_id"        INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "hour"           TIMESTAMP WITH TIME ZONE NOT NULL,
  "hits"           BIGINT NOT NULL DEFAULT 0,
  "bytes_served"   BIGINT NOT NULL DEFAULT 0,
  "unique_ips"     INTEGER NOT NULL DEFAULT 0,
  "top_referrers"  TEXT DEFAULT '[]',
  "top_paths"      TEXT DEFAULT '[]',
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE("site_id", "hour")
);

CREATE INDEX IF NOT EXISTS "site_analytics_site_hour_idx" ON "site_analytics"("site_id", "hour");
CREATE INDEX IF NOT EXISTS "site_analytics_hour_idx"      ON "site_analytics"("hour");

CREATE TABLE IF NOT EXISTS "analytics_buffer" (
  "id"           SERIAL PRIMARY KEY,
  "site_id"      INTEGER NOT NULL,
  "path"         TEXT NOT NULL,
  "referrer"     TEXT,
  "ip_hash"      TEXT,
  "bytes_served" INTEGER NOT NULL DEFAULT 0,
  "recorded_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "analytics_buffer_site_idx"     ON "analytics_buffer"("site_id");
CREATE INDEX IF NOT EXISTS "analytics_buffer_recorded_idx" ON "analytics_buffer"("recorded_at");

-- ─── Access control ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "site_members" (
  "id"                  SERIAL PRIMARY KEY,
  "site_id"             INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "user_id"             TEXT    NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role"                "site_member_role" NOT NULL DEFAULT 'viewer',
  "invited_by_user_id"  TEXT,
  "accepted_at"         TIMESTAMP WITH TIME ZONE,
  "created_at"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "site_members_site_idx" ON "site_members"("site_id");
CREATE INDEX IF NOT EXISTS "site_members_user_idx" ON "site_members"("user_id");

CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id"            SERIAL PRIMARY KEY,
  "user_id"       TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name"          TEXT NOT NULL,
  "token_hash"    TEXT NOT NULL,
  "token_prefix"  TEXT NOT NULL,
  "last_used_at"  TIMESTAMP WITH TIME ZONE,
  "expires_at"    TIMESTAMP WITH TIME ZONE,
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "revoked_at"    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS "api_tokens_user_idx" ON "api_tokens"("user_id");

CREATE TABLE IF NOT EXISTS "oauth_accounts" (
  "id"                SERIAL PRIMARY KEY,
  "user_id"           TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider"          TEXT NOT NULL,
  "provider_user_id"  TEXT NOT NULL,
  "provider_username" TEXT,
  "access_token"      TEXT,
  "refresh_token"     TEXT,
  "token_expires_at"  TIMESTAMP WITH TIME ZONE,
  "created_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "oauth_accounts_user_idx"     ON "oauth_accounts"("user_id");
CREATE INDEX IF NOT EXISTS "oauth_accounts_provider_idx" ON "oauth_accounts"("provider", "provider_user_id");

-- ─── Custom domains ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "custom_domains" (
  "id"                  SERIAL PRIMARY KEY,
  "site_id"             INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "domain"              TEXT NOT NULL UNIQUE,
  "verification_token"  TEXT NOT NULL,
  "status"              "domain_verification_status" NOT NULL DEFAULT 'pending',
  "verified_at"         TIMESTAMP WITH TIME ZONE,
  "last_checked_at"     TIMESTAMP WITH TIME ZONE,
  "last_error"          TEXT,
  "created_at"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "custom_domains_site_idx"   ON "custom_domains"("site_id");
CREATE INDEX IF NOT EXISTS "custom_domains_domain_idx" ON "custom_domains"("domain");
CREATE INDEX IF NOT EXISTS "custom_domains_status_idx" ON "custom_domains"("status");

-- ─── Admin audit log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "admin_audit_log" (
  "id"           SERIAL PRIMARY KEY,
  "actor_id"     TEXT    NOT NULL,
  "actor_email"  TEXT,
  "action"       TEXT    NOT NULL,
  "target_type"  TEXT    NOT NULL,
  "target_id"    TEXT,
  "metadata"     JSONB   NOT NULL DEFAULT '{}',
  "ip_address"   TEXT,
  "user_agent"   TEXT,
  "created_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "audit_log_actor_idx"  ON "admin_audit_log"("actor_id");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx" ON "admin_audit_log"("action");
CREATE INDEX IF NOT EXISTS "audit_log_time_idx"   ON "admin_audit_log"("created_at");

-- ─── Migration 0001: file content hash for deduplication ─────────────────────
-- Add content_hash column to site_files for deduplication.
-- SHA-256 of file content, hex-encoded (64 chars).

ALTER TABLE "site_files" ADD COLUMN IF NOT EXISTS "content_hash" TEXT;
CREATE INDEX IF NOT EXISTS "site_files_hash_idx" ON "site_files"("content_hash") WHERE "content_hash" IS NOT NULL;

-- ─── Site redirect rules ──────────────────────────────────────────────────────
-- Per-site HTTP redirect/rewrite rules (equivalent to _redirects in Netlify).
-- Processed in order. First matching rule wins.

CREATE TABLE IF NOT EXISTS "site_redirect_rules" (
  "id"          SERIAL PRIMARY KEY,
  "site_id"     INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "src"         TEXT    NOT NULL,   -- source path pattern (supports :param and * globs)
  "dest"        TEXT    NOT NULL,   -- destination URL or path
  "status"      INTEGER NOT NULL DEFAULT 301,  -- 301, 302, 200 (rewrite), 404, 410
  "force"       INTEGER NOT NULL DEFAULT 0,    -- 1 = redirect even if src file exists
  "position"    INTEGER NOT NULL DEFAULT 0,    -- lower = higher priority
  "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "redirect_rules_site_idx" ON "site_redirect_rules"("site_id", "position");

-- ─── Site custom headers ──────────────────────────────────────────────────────
-- Per-site custom response headers (equivalent to _headers in Netlify).

CREATE TABLE IF NOT EXISTS "site_custom_headers" (
  "id"          SERIAL PRIMARY KEY,
  "site_id"     INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "path"        TEXT    NOT NULL DEFAULT "/*",  -- path pattern to match
  "name"        TEXT    NOT NULL,               -- header name
  "value"       TEXT    NOT NULL,               -- header value
  "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "custom_headers_site_idx" ON "site_custom_headers"("site_id");

-- ─── Site invitations ─────────────────────────────────────────────────────────
-- Pending invitations sent by email to people who may not have an account yet.

CREATE TABLE IF NOT EXISTS "site_invitations" (
  "id"              SERIAL PRIMARY KEY,
  "site_id"         INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "invited_by"      TEXT    NOT NULL REFERENCES "users"("id"),
  "email"           TEXT    NOT NULL,
  "role"            "site_member_role" NOT NULL DEFAULT 'viewer',
  "token"           TEXT    NOT NULL UNIQUE,
  "accepted_at"     TIMESTAMP WITH TIME ZONE,
  "expires_at"      TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "invitations_site_idx"  ON "site_invitations"("site_id");
CREATE INDEX IF NOT EXISTS "invitations_email_idx" ON "site_invitations"("email");
CREATE INDEX IF NOT EXISTS "invitations_token_idx" ON "site_invitations"("token");

-- ─── Staging environments ─────────────────────────────────────────────────────
-- Each site can have named environments (production, staging, preview, etc.)
-- Each environment gets a unique subdomain and its own deployment history.

ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "preview_url" TEXT;
CREATE INDEX IF NOT EXISTS "deployments_env_idx" ON "site_deployments"("site_id", "environment");

-- ─── Form submissions ─────────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS "form_submissions_site_idx" ON "form_submissions"("site_id");
CREATE INDEX IF NOT EXISTS "form_submissions_created_idx" ON "form_submissions"("site_id", "created_at" DESC);

-- ─── Build jobs ───────────────────────────────────────────────────────────────
CREATE TYPE IF NOT EXISTS "build_status" AS ENUM('queued', 'running', 'success', 'failed', 'cancelled');
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

-- ─── TOTP (two-factor auth) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "totp_credentials" (
  "id"           SERIAL PRIMARY KEY,
  "user_id"      TEXT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "secret"       TEXT NOT NULL,
  "backup_codes" JSONB NOT NULL DEFAULT '[]',
  "enabled_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ─── Email queue ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_queue" (
  "id"          SERIAL PRIMARY KEY,
  "to"          TEXT    NOT NULL,
  "subject"     TEXT    NOT NULL,
  "html"        TEXT    NOT NULL,
  "text"        TEXT    NOT NULL,
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_attempt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "sent_at"     TIMESTAMP WITH TIME ZONE,
  "failed_at"   TIMESTAMP WITH TIME ZONE,
  "error"       TEXT,
  "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "email_queue_pending_idx"
  ON "email_queue"("next_attempt")
  WHERE "sent_at" IS NULL AND "failed_at" IS NULL;

-- ─── Site health history ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "site_health_checks" (
  "id"          SERIAL PRIMARY KEY,
  "site_id"     INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "status"      TEXT    NOT NULL,
  "http_status" INTEGER,
  "response_ms" INTEGER,
  "error"       TEXT,
  "checked_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "health_checks_site_time_idx"
  ON "site_health_checks"("site_id", "checked_at" DESC);

-- ─── Webhook delivery log ─────────────────────────────────────────────────────
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

-- ─── Full-text search on sites ────────────────────────────────────────────────
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "search_vector" TSVECTOR;

UPDATE "sites" SET search_vector = to_tsvector('english',
  coalesce(name, '') || ' ' || coalesce(domain, '') || ' ' || coalesce(description, '')
);

CREATE INDEX IF NOT EXISTS "sites_search_idx" ON "sites" USING GIN("search_vector");

CREATE OR REPLACE FUNCTION sites_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.name, '') || ' ' || coalesce(NEW.domain, '') || ' ' || coalesce(NEW.description, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sites_search_vector_trigger ON "sites";
CREATE TRIGGER sites_search_vector_trigger
  BEFORE INSERT OR UPDATE OF name, domain, description ON "sites"
  FOR EACH ROW EXECUTE FUNCTION sites_search_vector_update();

-- ─── Site environment variables ───────────────────────────────────────────────
-- Stored env vars injected into build pipeline jobs for this site.
CREATE TABLE IF NOT EXISTS "site_env_vars" (
  "id"         SERIAL PRIMARY KEY,
  "site_id"    INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "key"        TEXT    NOT NULL,
  "value"      TEXT    NOT NULL,
  "secret"     INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE("site_id", "key")
);
CREATE INDEX IF NOT EXISTS "site_env_vars_site_idx" ON "site_env_vars"("site_id");

-- ─── Per-site password gate customisation ────────────────────────────────────
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "unlock_message" TEXT;

-- ─── Webhooks ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "webhooks" (
  "id"         SERIAL PRIMARY KEY,
  "site_id"    INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "url"        TEXT    NOT NULL,
  "secret"     TEXT,
  "events"     TEXT    NOT NULL DEFAULT '*',
  "enabled"    INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "webhooks_site_idx" ON "webhooks"("site_id");

-- ─── API token scopes ─────────────────────────────────────────────────────────
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "scopes" TEXT NOT NULL DEFAULT 'read,write,deploy';

-- ─── Add maintenance status to sites (idempotent) ─────────────────────────────
ALTER TYPE "site_status" ADD VALUE IF NOT EXISTS 'maintenance';

-- ─── Maintenance message column ───────────────────────────────────────────────
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "maintenance_message" TEXT;

-- ─── Federation blocklist ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "federation_blocks" (
  "id"           SERIAL PRIMARY KEY,
  "node_domain"  TEXT NOT NULL UNIQUE,
  "reason"       TEXT,
  "blocked_by"   TEXT,
  "created_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "federation_blocks_domain_idx" ON "federation_blocks"("node_domain");

-- ─── spa_routing column on sites ────────────────────────────────────────────
-- 1 = serve index.html for unknown paths (SPA), 0 = strict 404 (MPA/static)
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "spa_routing" INTEGER NOT NULL DEFAULT 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- Category 1: Core Platform Gaps
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── User account additions ──────────────────────────────────────────────────
-- email_verified: verified via link sent to email on first login
-- storage_cap_mb: operator-set per-user cap (0 = no cap, node capacity is the only limit)
-- suspended_at:   operator can suspend a user without deleting their account
--
-- NOTE: NexusHosting is free — there are NO paid tiers, NO pricing, NO limits except
-- what the node operator sets for capacity reasons. storage_cap_mb is a node
-- administration tool, not a paywall.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified"  INTEGER  NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "storage_cap_mb"  INTEGER  NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspended_at"    TIMESTAMP WITH TIME ZONE;

-- ─── Email verification tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_verification_tokens" (
  "id"         SERIAL PRIMARY KEY,
  "user_id"    VARCHAR NOT NULL,
  "email"      VARCHAR NOT NULL,
  "token"      VARCHAR(64) NOT NULL UNIQUE,
  "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "used_at"    TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "email_tokens_user_idx"  ON "email_verification_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "email_tokens_token_idx" ON "email_verification_tokens"("token");

-- ─── Abuse reports ────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "abuse_reason" AS ENUM (
    'spam','phishing','malware','csam','copyright','harassment','illegal_content','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "abuse_status" AS ENUM (
    'pending','under_review','resolved_removed','resolved_no_action','escalated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "abuse_reports" (
  "id"             SERIAL PRIMARY KEY,
  "site_id"        INTEGER NOT NULL,
  "site_domain"    TEXT    NOT NULL,
  "reporter_ip"    TEXT,
  "reporter_email" TEXT,
  "reason"         "abuse_reason" NOT NULL,
  "description"    TEXT,
  "evidence_url"   TEXT,
  "status"         "abuse_status" NOT NULL DEFAULT 'pending',
  "reviewed_by"    VARCHAR,
  "reviewed_at"    TIMESTAMP WITH TIME ZONE,
  "review_notes"   TEXT,
  "action_taken"   INTEGER NOT NULL DEFAULT 0,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "abuse_reports_site_idx"   ON "abuse_reports"("site_id");
CREATE INDEX IF NOT EXISTS "abuse_reports_status_idx" ON "abuse_reports"("status");

-- ─── IP bans ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ip_ban_scope" AS ENUM ('api', 'sites', 'all');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ip_bans" (
  "id"         SERIAL PRIMARY KEY,
  "ip_address" TEXT NOT NULL,
  "cidr_range" TEXT,
  "reason"     TEXT,
  "scope"      "ip_ban_scope" NOT NULL DEFAULT 'all',
  "banned_by"  VARCHAR,
  "expires_at" TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ip_bans_ip_idx" ON "ip_bans"("ip_address");

-- ═══════════════════════════════════════════════════════════════════════════
-- Category 2: Federation Maturity
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Node trust scores ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "node_trust_level" AS ENUM (
    'unverified', 'verified', 'trusted', 'blocked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "node_trust" (
  "id"                SERIAL PRIMARY KEY,
  "node_domain"       TEXT NOT NULL UNIQUE,
  "trust_level"       "node_trust_level" NOT NULL DEFAULT 'unverified',
  "successful_pings"  INTEGER NOT NULL DEFAULT 0,
  "failed_pings"      INTEGER NOT NULL DEFAULT 0,
  "uptime_percent"    INTEGER NOT NULL DEFAULT 100,
  "first_seen_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "last_ping_at"      TIMESTAMP WITH TIME ZONE,
  "manually_reviewed" INTEGER NOT NULL DEFAULT 0,
  "reviewed_by"       VARCHAR,
  "review_notes"      TEXT,
  "updated_at"        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "node_trust_domain_idx" ON "node_trust"("node_domain");
CREATE INDEX IF NOT EXISTS "node_trust_level_idx"  ON "node_trust"("trust_level");

-- ═══════════════════════════════════════════════════════════════════════════
-- Local auth (email + password, Step 4)
-- ═══════════════════════════════════════════════════════════════════════════

-- Local auth credentials (separate from OIDC sessions)
-- Allows email+password login without requiring an external OIDC provider.
-- password_hash is bcrypt (cost 12). token_hash is SHA-256 of reset token.
CREATE TABLE IF NOT EXISTS "local_auth" (
  "id"            SERIAL PRIMARY KEY,
  "user_id"       VARCHAR NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "email"         VARCHAR NOT NULL UNIQUE,
  "password_hash" TEXT NOT NULL,
  "created_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "local_auth_email_idx" ON "local_auth"("email");

-- Password reset tokens (single-use, 1h TTL)
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id"         SERIAL PRIMARY KEY,
  "user_id"    VARCHAR NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL UNIQUE,
  "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
  "used_at"    TIMESTAMP WITH TIME ZONE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "pwd_reset_token_idx" ON "password_reset_tokens"("token_hash");
