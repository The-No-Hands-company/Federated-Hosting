import { Router, type IRouter, type Request, type Response } from "express";
import { db, nodesTable, siteFilesTable, sitesTable } from "@workspace/db";
import { eq, sum, count } from "drizzle-orm";
import { serializeDates } from "../lib/serialize";

const router: IRouter = Router();

router.get("/nodes/:id/capacity", async (req: Request, res: Response) => {
  const nodeId = parseInt(req.params.id as string, 10);
  const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, nodeId));

  if (!node) {
    res.status(404).json({ error: "Node not found" });
    return;
  }

  const [storageStat] = await db
    .select({ totalMb: sum(sitesTable.storageUsedMb), siteCount: count(sitesTable.id) })
    .from(sitesTable)
    .where(eq(sitesTable.primaryNodeId, nodeId));

  const usedMb = parseFloat(storageStat?.totalMb ?? "0") || 0;
  const usedGb = usedMb / 1024;
  const capacityGb = node.storageCapacityGb;
  const availableGb = Math.max(0, capacityGb - usedGb);
  const usedPercent = capacityGb > 0 ? Math.min(100, (usedGb / capacityGb) * 100) : 0;

  res.json(serializeDates({
    nodeId,
    nodeName: node.name,
    nodeDomain: node.domain,
    storage: {
      capacityGb,
      usedGb: parseFloat(usedGb.toFixed(4)),
      availableGb: parseFloat(availableGb.toFixed(4)),
      usedPercent: parseFloat(usedPercent.toFixed(2)),
    },
    bandwidth: {
      capacityGb: node.bandwidthCapacityGb,
    },
    siteCount: storageStat?.siteCount ?? 0,
    status: node.status,
  }));
});

router.get("/capacity/summary", async (_req: Request, res: Response) => {
  const nodes = await db.select().from(nodesTable);

  const summary = await Promise.all(
    nodes.map(async (node) => {
      const [storageStat] = await db
        .select({ totalMb: sum(sitesTable.storageUsedMb), siteCount: count(sitesTable.id) })
        .from(sitesTable)
        .where(eq(sitesTable.primaryNodeId, node.id));

      const usedMb = parseFloat(storageStat?.totalMb ?? "0") || 0;
      const usedGb = usedMb / 1024;

      return {
        nodeId: node.id,
        name: node.name,
        domain: node.domain,
        region: node.region,
        status: node.status,
        isLocalNode: node.isLocalNode === 1,
        storage: {
          capacityGb: node.storageCapacityGb,
          usedGb: parseFloat(usedGb.toFixed(4)),
          usedPercent: node.storageCapacityGb > 0
            ? parseFloat(((usedGb / node.storageCapacityGb) * 100).toFixed(2))
            : 0,
        },
        siteCount: storageStat?.siteCount ?? 0,
      };
    })
  );

  const totalCapacityGb = nodes.reduce((a, n) => a + n.storageCapacityGb, 0);
  const totalSites = summary.reduce((a, n) => a + Number(n.siteCount), 0);

  res.json({
    nodes: summary,
    network: {
      nodeCount: nodes.length,
      totalCapacityGb: parseFloat(totalCapacityGb.toFixed(2)),
      totalSites,
    },
  });
});

router.post("/nodes/:id/update-capacity", async (req: Request, res: Response) => {
  const nodeId = parseInt(req.params.id as string, 10);
  const { storageCapacityGb, bandwidthCapacityGb, status } = req.body;

  const updates: Record<string, any> = {};
  if (storageCapacityGb !== undefined) updates.storageCapacityGb = storageCapacityGb;
  if (bandwidthCapacityGb !== undefined) updates.bandwidthCapacityGb = bandwidthCapacityGb;
  if (status !== undefined) updates.status = status;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  await db.update(nodesTable).set(updates).where(eq(nodesTable.id, nodeId));
  const [updated] = await db.select().from(nodesTable).where(eq(nodesTable.id, nodeId));

  res.json(serializeDates(updated));
});

export default router;
