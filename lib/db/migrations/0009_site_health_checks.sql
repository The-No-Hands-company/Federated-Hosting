-- History of site health checks.
--
-- lib/siteHealthMonitor.ts wrote to a `siteHealthChecksTable` that had never
-- been defined. The module therefore could not compile, and nothing imports
-- it, so the failure was invisible until the package was typechecked for the
-- first time. Columns here are exactly the ones that insert supplies.
CREATE TABLE IF NOT EXISTS "site_health_checks" (
    "id"          serial PRIMARY KEY NOT NULL,
    "site_id"     integer NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
    "status"      text NOT NULL,
    "http_status" integer,
    "response_ms" integer,
    "error"       text,
    "checked_at"  timestamp with time zone DEFAULT now() NOT NULL
);

-- The query this exists to serve is "recent checks for this site, newest
-- first", so the index is on the pair rather than site alone.
CREATE INDEX IF NOT EXISTS "site_health_checks_site_time_idx"
    ON "site_health_checks" ("site_id", "checked_at");
