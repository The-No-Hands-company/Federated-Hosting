import { Router, type IRouter, type Request, type Response } from "express";
import { db, sitesTable, siteDeploymentsTable, siteFilesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/errors";

const router: IRouter = Router();

/**
 * GET /api/sites/:id/deployments/:depId/diff?base=:prevDepId
 *
 * Returns a diff between two deployments:
 *   added:   files in depId not in base
 *   removed: files in base not in depId
 *   changed: files with different contentHash in both
 *   unchanged: files identical in both (by hash)
 *
 * If base is omitted, compares against the deployment immediately before depId.
 */
router.get("/sites/:id/deployments/:depId/diff", asyncHandler(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const siteId = parseInt(req.params.id   as string, 10);
  const depId  = parseInt(req.params.depId as string, 10);
  if (isNaN(siteId) || isNaN(depId)) throw AppError.badRequest("Invalid ID");

  const [site] = await db.select({ ownerId: sitesTable.ownerId })
    .from(sitesTable).where(eq(sitesTable.id, siteId));
  if (!site) throw AppError.notFound("Site not found");
  if (site.ownerId !== req.user.id) throw AppError.forbidden();

  // Target deployment
  const [target] = await db.select()
    .from(siteDeploymentsTable)
    .where(and(eq(siteDeploymentsTable.id, depId), eq(siteDeploymentsTable.siteId, siteId)));
  if (!target) throw AppError.notFound("Deployment not found");

  // Base deployment — either specified via ?base= or the one immediately before
  let baseDepId = parseInt(req.query.base as string, 10);
  if (isNaN(baseDepId)) {
    const [prev] = await db.select({ id: siteDeploymentsTable.id })
      .from(siteDeploymentsTable)
      .where(and(
        eq(siteDeploymentsTable.siteId, siteId),
        eq(siteDeploymentsTable.version, target.version - 1),
      ));
    baseDepId = prev?.id ?? 0;
  }

  // Get file lists for both deployments.
  //
  // The row type is named and the tuple annotated because the second element
  // is a ternary whose empty branch is Promise.resolve([]) — inferred as
  // never[]. Without this, Promise.all gives both destructured arrays the
  // union `DiffFile[] | never[]`, and pushing into a union of array types
  // requires their intersection: never. Six of this package's type errors came
  // from that, and they made the diff body invisible to the compiler.
  type DiffFile = { filePath: string; contentHash: string | null; sizeBytes: number };

  const [targetFiles, baseFiles]: [DiffFile[], DiffFile[]] = await Promise.all([
    db.select({ filePath: siteFilesTable.filePath, contentHash: siteFilesTable.contentHash, sizeBytes: siteFilesTable.sizeBytes })
      .from(siteFilesTable)
      .where(and(eq(siteFilesTable.siteId, siteId), eq(siteFilesTable.deploymentId, depId))),
    baseDepId
      ? db.select({ filePath: siteFilesTable.filePath, contentHash: siteFilesTable.contentHash, sizeBytes: siteFilesTable.sizeBytes })
          .from(siteFilesTable)
          .where(and(eq(siteFilesTable.siteId, siteId), eq(siteFilesTable.deploymentId, baseDepId)))
      : Promise.resolve([] as DiffFile[]),
  ]);

  const targetMap = new Map(targetFiles.map(f => [f.filePath, f]));
  const baseMap   = new Map(baseFiles.map(f => [f.filePath, f]));

  const added:     DiffFile[] = [];
  const changed:   DiffFile[] = [];
  const unchanged: DiffFile[] = [];
  const removed:   DiffFile[] = [];

  for (const [path, file] of targetMap) {
    const base = baseMap.get(path);
    if (!base) {
      added.push(file);
    } else if (file.contentHash && base.contentHash && file.contentHash !== base.contentHash) {
      changed.push(file);
    } else {
      unchanged.push(file);
    }
  }

  for (const [path, file] of baseMap) {
    if (!targetMap.has(path)) removed.push(file);
  }

  const totalSizeAdded   = added.reduce((a, f)   => a + (f.sizeBytes ?? 0), 0);
  const totalSizeRemoved = removed.reduce((a, f) => a + (f.sizeBytes ?? 0), 0);

  res.json({
    targetVersion: target.version,
    baseVersion:   baseDepId ? (target.version - 1) : null,
    summary: {
      added:     added.length,
      changed:   changed.length,
      removed:   removed.length,
      unchanged: unchanged.length,
      total:     targetFiles.length,
      netSizeBytes: totalSizeAdded - totalSizeRemoved,
    },
    added:     added.sort((a, b) => a.filePath.localeCompare(b.filePath)),
    changed:   changed.sort((a, b) => a.filePath.localeCompare(b.filePath)),
    removed:   removed.sort((a, b) => a.filePath.localeCompare(b.filePath)),
  });
}));

export default router;
