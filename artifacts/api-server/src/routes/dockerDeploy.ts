import { Router, type IRouter, type Request, type Response } from "express";
import { db, sitesTable, siteDeploymentsTable, siteEnvVarsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";
import { requireScope } from "../middleware/tokenAuth";
import { startDockerContainer } from "../lib/dockerManager";
import logger from "../lib/logger";

const router: IRouter = Router();

/**
 * POST /sites/:id/docker-deploy
 * Deploy a Docker container for a site.
 * Requires deploy scope.
 */
router.post(
  "/sites/:id/docker-deploy",
  requireScope("deploy"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) throw AppError.unauthorized();

    const siteId = parseInt(req.params.id as string, 10);
    if (Number.isNaN(siteId)) throw AppError.badRequest("Invalid site ID");

    // Fetch the site to verify ownership and type
    const [site] = await db
      .select()
      .from(sitesTable)
      .where(eq(sitesTable.id, siteId));

    if (!site) throw AppError.notFound("Site not found");
    if (site.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can deploy");

    // Only allow Docker deployments for sites of type docker
    if (site.siteType !== "docker") {
      throw AppError.badRequest(
        `Site ${site.id} is not a Docker site (current type: ${site.siteType})`,
        "INVALID_SITE_TYPE_FOR_DOCKER_DEPLOY"
      );
    }

    // We expect a JSON body with image and optional tag
    // For simplicity, we don't use a Zod schema here, but we could.
    const { image, tag } = req.body as { image: string; tag?: string | null };

    if (!image || typeof image !== "string") {
      throw AppError.badRequest("Image is required and must be a string", "INVALID_IMAGE");
    }

    // Normalize tag: if empty string, treat as null
    const normalizedTag = tag === "" ? null : tag;

    // Fetch environment variables for this site
    const envVars = await db
      .select({ key: siteEnvVarsTable.key, value: siteEnvVarsTable.value })
      .from(siteEnvVarsTable)
      .where(eq(siteEnvVarsTable.siteId, siteId));

    // Convert to object format expected by dockerManager
    const env: Record<string, string> = {};
    for (const { key, value } of envVars) {
      env[key] = value;
    }

    // Create a new deployment record
    // We'll get the current version count for this site and increment
    // db.select() resolves to a row array, not an array of row arrays. The
    // extra destructuring level made TypeScript try to iterate a row object,
    // and `sql` was never imported at all — this file could not have compiled,
    // so the Docker deploy path has never been typechecked.
    const [{ version: currentVersion }] = await db
      .select({ version: sql<number>`MAX(${siteDeploymentsTable.version})` })
      .from(siteDeploymentsTable)
      .where(eq(siteDeploymentsTable.siteId, siteId));

    const newVersion = (currentVersion ?? 0) + 1;

    const [deployment] = await db
      .insert(siteDeploymentsTable)
      .values({
        siteId,
        version: newVersion,
        deployedBy: req.user.id,
        environment: "production", // We could make this configurable
        status: "pending",
        fileCount: 0,
        totalSizeMb: 0,
        image: image,
        tag: normalizedTag,
      })
      .returning();

    try {
      // Start the Docker container (this will stop any existing one and start a new)
      const { port } = await startDockerContainer({
        siteId: site.id,
        siteDomain: site.domain,
        image,
        // startDockerContainer takes string | null — null means "use the
        // image's default tag" — so the null is meaningful and kept. Only the
        // undefined needed removing, which arrives when the request omits tag
        // entirely rather than sending an empty one.
        tag: normalizedTag ?? null,
        env: env ?? undefined, // Pass the environment variables
      });

      // Update the deployment to active
      await db
        .update(siteDeploymentsTable)
        .set({ status: "active" })
        .where(eq(siteDeploymentsTable.id, deployment.id));

      // Fetch the updated deployment to return
      const [updatedDeployment] = await db
        .select()
        .from(siteDeploymentsTable)
        .where(eq(siteDeploymentsTable.id, deployment.id));

      res.status(202).json(updatedDeployment);
    } catch (err) {
      // Mark the deployment as failed
      await db
        .update(siteDeploymentsTable)
        .set({ status: "failed" })
        .where(eq(siteDeploymentsTable.id, deployment.id));

      logger.error(
        { siteId: site.id, deploymentId: deployment.id, err: (err as Error).message },
        "[docker-deploy] Failed to start container"
      );

      throw AppError.badRequest(
        (err as Error).message || "Failed to start Docker container",
        "DOCKER_DEPLOY_FAILED"
      );
    }
  })
);

export default router;