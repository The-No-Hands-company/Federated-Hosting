-- Catch-up: bring the database in line with lib/db/src/schema.
--
-- The schema had drifted five columns and twelve indexes ahead of the committed
-- migrations. It was invisible because docker-compose ran `db push`, which
-- reshapes the database to match the ORM on every start and so silently papered
-- over every missing migration. Switching the migrate job to apply real
-- migrations — which lib/db/migrations/README.md and CLAUDE.md both require —
-- surfaced it immediately: deploying a site failed with
-- `column "environment" of relation "site_deployments" does not exist`.
--
-- The delta was computed rather than guessed: the ORM schema was materialised
-- into an empty scratch database and diffed against production, so this is
-- exactly what is missing and nothing more. Against an empty database there is
-- no rename ambiguity, which is what made the diff deterministic.
--
-- Every statement is IF NOT EXISTS so this is safe on a database that already
-- has some of it, including one previously reshaped by `db push`.

ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "environment" TEXT NOT NULL DEFAULT 'production';
ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "preview_url" TEXT;

ALTER TABLE "admin_audit_log" ADD COLUMN IF NOT EXISTS "before" TEXT;
ALTER TABLE "admin_audit_log" ADD COLUMN IF NOT EXISTS "after" TEXT;
ALTER TABLE "admin_audit_log" ADD COLUMN IF NOT EXISTS "ip" TEXT;

-- Indexes the schema declares. The unique ones are constraints the application
-- relies on for correctness, not just speed: without them duplicate domains,
-- emails and tokens are insertable.
CREATE INDEX IF NOT EXISTS "site_deployments_env_idx" ON "site_deployments" ("site_id", "environment");
CREATE INDEX IF NOT EXISTS "audit_log_created_idx" ON "admin_audit_log" ("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_unique" ON "users" ("email");
CREATE UNIQUE INDEX IF NOT EXISTS "sites_domain_unique" ON "sites" ("domain");
CREATE UNIQUE INDEX IF NOT EXISTS "nodes_domain_unique" ON "nodes" ("domain");
CREATE UNIQUE INDEX IF NOT EXISTS "custom_domains_domain_unique" ON "custom_domains" ("domain");
CREATE UNIQUE INDEX IF NOT EXISTS "node_trust_node_domain_unique" ON "node_trust" ("node_domain");
CREATE UNIQUE INDEX IF NOT EXISTS "federation_blocks_node_domain_unique" ON "federation_blocks" ("node_domain");
CREATE UNIQUE INDEX IF NOT EXISTS "email_verification_tokens_token_unique" ON "email_verification_tokens" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "site_invitations_token_unique" ON "site_invitations" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "totp_credentials_user_id_unique" ON "totp_credentials" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "site_env_vars_unique" ON "site_env_vars" ("site_id", "key");
