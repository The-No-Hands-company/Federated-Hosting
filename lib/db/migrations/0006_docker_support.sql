-- Docker support for sites and deployments.
--
-- src/schema/sites.ts and src/schema/deployments.ts declare `image` and `tag`
-- and add 'docker' to the site_type enum, and routes/dockerDeploy.ts is wired
-- into the router — but no migration created any of it, so the schema and the
-- database disagreed. This closes that gap.
--
-- Every statement is idempotent: on a database that already had these columns
-- applied out-of-band, re-running is a no-op. ALTER TYPE ... ADD VALUE is
-- permitted inside the runner's BEGIN/COMMIT on PostgreSQL 12+ provided the new
-- value is not used in the same transaction, which it is not here.

ALTER TYPE "site_type" ADD VALUE IF NOT EXISTS 'docker';

-- Docker image name and tag for a site and for each of its deployments.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "tag" TEXT;

ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "site_deployments" ADD COLUMN IF NOT EXISTS "tag" TEXT;
