-- Federated Hosting — Initial Database Migration
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
  CREATE TYPE "site_type" AS ENUM('static', 'dynamic', 'blog', 'portfolio', 'other');
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
