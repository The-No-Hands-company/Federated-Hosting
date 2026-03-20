import { Router, type IRouter } from "express";
import { eq, count, ilike, or, sql } from "drizzle-orm";
import { db, sitesTable, nodesTable } from "@workspace/db";
import {
  CreateSiteBody,
  UpdateSiteBody,
  UpdateSiteParams,
  GetSiteParams,
  DeleteSiteParams,
  GetSiteResponse,
  UpdateSiteResponse,
} from "@workspace/api-zod";
import { serializeDates } from "../lib/serialize";
import { asyncHandler, AppError } from "../lib/errors";
import { parsePagination, buildPaginatedResponse } from "../lib/pagination";
import { writeLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

const SITE_SELECT = {
  id: sitesTable.id,
  name: sitesTable.name,
  domain: sitesTable.domain,
  description: sitesTable.description,
  status: sitesTable.status,
  siteType: sitesTable.siteType,
  ownerName: sitesTable.ownerName,
  ownerEmail: sitesTable.ownerEmail,
  ownerId: sitesTable.ownerId,
  primaryNodeId: sitesTable.primaryNodeId,
  primaryNodeDomain: nodesTable.domain,
  replicaCount: sitesTable.replicaCount,
  storageUsedMb: sitesTable.storageUsedMb,
  monthlyBandwidthGb: sitesTable.monthlyBandwidthGb,
  createdAt: sitesTable.createdAt,
  updatedAt: sitesTable.updatedAt,
} as const;

router.get("/sites", asyncHandler(async (req, res) => {
  const { limit, offset, page } = parsePagination(req);
  const search = req.query.search as string | undefined;
  const statusFilter = req.query.status as string | undefined;
  const ownerId = req.query.ownerId as string | undefined;

  const whereClause = search
    ? search.length >= 3
      ? sql`"search_vector" @@ plainto_tsquery('english', ${search})`
      : or(ilike(sitesTable.name, `%${search}%`), ilike(sitesTable.domain, `%${search}%`))
    : statusFilter
    ? eq(sitesTable.status, statusFilter as "active" | "suspended" | "migrating")
    : ownerId
    ? eq(sitesTable.ownerId, ownerId)
    : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(sitesTable)
    .where(whereClause);

  const sites = await db
    .select(SITE_SELECT)
    .from(sitesTable)
    .leftJoin(nodesTable, eq(sitesTable.primaryNodeId, nodesTable.id))
    .where(whereClause)
    .orderBy(sitesTable.createdAt)
    .limit(limit)
    .offset(offset);

  res.json(buildPaginatedResponse(serializeDates(sites), Number(total), { limit, offset, page }));
}));

router.post("/sites", writeLimiter, asyncHandler(async (req, res) => {
  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [existing] = await db.select().from(sitesTable).where(eq(sitesTable.domain, parsed.data.domain));
  if (existing) throw AppError.conflict(`Domain '${parsed.data.domain}' is already registered`);

  const [site] = await db.insert(sitesTable).values(parsed.data).returning();
  const [joined] = await db
    .select(SITE_SELECT)
    .from(sitesTable)
    .leftJoin(nodesTable, eq(sitesTable.primaryNodeId, nodesTable.id))
    .where(eq(sitesTable.id, site.id));

  res.status(201).json(GetSiteResponse.parse(serializeDates(joined)));
}));

router.get("/sites/:id", asyncHandler(async (req, res) => {
  const params = GetSiteParams.safeParse(req.params);
  if (!params.success) throw AppError.badRequest(params.error.message);

  const [site] = await db
    .select(SITE_SELECT)
    .from(sitesTable)
    .leftJoin(nodesTable, eq(sitesTable.primaryNodeId, nodesTable.id))
    .where(eq(sitesTable.id, params.data.id));

  if (!site) throw AppError.notFound(`Site ${params.data.id} not found`);
  res.json(GetSiteResponse.parse(serializeDates(site)));
}));

router.patch("/sites/:id", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const params = UpdateSiteParams.safeParse(req.params);
  if (!params.success) throw AppError.badRequest(params.error.message);

  const parsed = UpdateSiteBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  // Fetch first to verify ownership
  const [existing] = await db
    .select({ id: sitesTable.id, ownerId: sitesTable.ownerId })
    .from(sitesTable)
    .where(eq(sitesTable.id, params.data.id));

  if (!existing) throw AppError.notFound(`Site ${params.data.id} not found`);
  if (existing.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can update this site");

  const [updated] = await db
    .update(sitesTable)
    .set(parsed.data)
    .where(eq(sitesTable.id, params.data.id))
    .returning();

  if (!updated) throw AppError.notFound(`Site ${params.data.id} not found`);

  const [joined] = await db
    .select(SITE_SELECT)
    .from(sitesTable)
    .leftJoin(nodesTable, eq(sitesTable.primaryNodeId, nodesTable.id))
    .where(eq(sitesTable.id, updated.id));

  res.json(UpdateSiteResponse.parse(serializeDates(joined)));
}));

router.delete("/sites/:id", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const params = DeleteSiteParams.safeParse(req.params);
  if (!params.success) throw AppError.badRequest(params.error.message);

  // Fetch first to verify ownership
  const [existing] = await db
    .select({ id: sitesTable.id, ownerId: sitesTable.ownerId })
    .from(sitesTable)
    .where(eq(sitesTable.id, params.data.id));

  if (!existing) throw AppError.notFound(`Site ${params.data.id} not found`);
  if (existing.ownerId !== req.user.id) throw AppError.forbidden("Only the site owner can delete this site");

  await db.delete(sitesTable).where(eq(sitesTable.id, params.data.id));
  res.sendStatus(204);
}));

export default router;
