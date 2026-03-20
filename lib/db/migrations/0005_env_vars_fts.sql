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

ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "search_vector" TSVECTOR;

UPDATE "sites" SET search_vector = to_tsvector('english',
  coalesce(name, '') || ' ' || coalesce(domain, '') || ' ' || coalesce(description, '')
) WHERE search_vector IS NULL;

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
