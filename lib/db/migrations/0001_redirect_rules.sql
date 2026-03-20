-- Applied by migrate.ts automatically after 0000_initial_schema.sql
-- Adds redirect rules and custom response headers per site.

CREATE TABLE IF NOT EXISTS "site_redirect_rules" (
  "id"          SERIAL PRIMARY KEY,
  "site_id"     INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "src"         TEXT    NOT NULL,
  "dest"        TEXT    NOT NULL,
  "status"      INTEGER NOT NULL DEFAULT 301,
  "force"       INTEGER NOT NULL DEFAULT 0,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "redirect_rules_site_idx" ON "site_redirect_rules"("site_id", "position");

CREATE TABLE IF NOT EXISTS "site_custom_headers" (
  "id"          SERIAL PRIMARY KEY,
  "site_id"     INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "path"        TEXT    NOT NULL DEFAULT '/*',
  "name"        TEXT    NOT NULL,
  "value"       TEXT    NOT NULL,
  "created_at"  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "custom_headers_site_idx" ON "site_custom_headers"("site_id");
