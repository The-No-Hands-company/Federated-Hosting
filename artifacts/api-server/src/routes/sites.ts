import { requireScope } from "../middleware/tokenAuth";
import { Router, type IRouter } from "express";
import { eq, count, ilike, or, sql } from "drizzle-orm";
import { db, sitesTable, nodesTable, usersTable } from "@workspace/db";
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
  image: sitesTable.image,
  tag: sitesTable.tag,
  ownerName: sitesTable.ownerName,
  // ownerEmail is deliberately absent. GET /sites and GET /sites/:id are
  // unauthenticated — the public site directory — and this select feeds both.
  // Every site listed was publishing its owner's email address to anyone who
  // asked, which is personal data given away for nothing and the exact
  // behaviour this project exists to refuse. Nothing needed it: the client
  // collects the address on the create form and the admin view reads it from
  // the admin route, which has its own select and its own authorisation.
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
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const parsed = CreateSiteBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  // No per-user site count limits — NexusHosting is free for everyone, always.

  // Enforce NEXUS_STATIC_ONLY — only allow static/blog/portfolio site types
  const dynamicTypes = ["nlpl", "dynamic", "node", "python", "docker"];
  if (process.env.NEXUS_STATIC_ONLY === "true" && dynamicTypes.includes(parsed.data.siteType ?? "")) {
    throw AppError.badRequest(
      `This node operates in static-only mode (NEXUS_STATIC_ONLY=true). ` +
      `Dynamic site types (${dynamicTypes.join(", ")}) are not permitted. ` +
      `Create a static site or use a node that supports dynamic hosting.`,
      "STATIC_ONLY_NODE",
    );
  }

  // NOTE: there was a docker-specific validation here and it could never run.
  //
  // The database's site_type enum includes "docker" and "nlpl", but the API
  // contract (CreateSiteBody, generated from lib/api-spec/openapi.yaml) allows
  // only static | dynamic | blog | portfolio | other, and has no `image` field
  // at all. So a request with siteType "docker" is rejected by schema
  // validation long before reaching this line, and the check was dead code
  // guarding a state the endpoint cannot produce.
  //
  // Docker sites can still be *deployed* — routes/dockerDeploy.ts reads
  // siteType from the database row, which does support it — they just cannot
  // be *created* through this endpoint. Closing that gap means adding "docker"
  // and `image` to the OpenAPI spec and regenerating lib/api-zod, which is
  // blocked on the orval codegen failure documented at the top of openapi.yaml.
  // Deleting the check rather than leaving it is the honest option: it was not
  // protecting anything.

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

router.patch("/sites/:id", writeLimiter, requireScope("write"), asyncHandler(async (req, res) => {
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

  // Enforce NEXUS_STATIC_ONLY — only allow static/blog/portfolio site types
  const dynamicTypes = ["nlpl", "dynamic", "node", "python", "docker"];
  if (process.env.NEXUS_STATIC_ONLY === "true" && parsed.data.siteType !== undefined && dynamicTypes.includes(parsed.data.siteType)) {
    throw AppError.badRequest(
      `This node operates in static-only mode (NEXUS_STATIC_ONLY=true). ` +
      `Dynamic site types (${dynamicTypes.join(", ")}) are not permitted. ` +
      `Create a static site or use a node that supports dynamic hosting.`,
      "STATIC_ONLY_NODE",
    );
  }

  // NOTE: a docker-image check stood here and was unreachable for the same
  // reason as the one in the create route above — UpdateSiteBody's siteType
  // union has no "docker" and the body has no `image` field, so the condition
  // could never be true. Removed rather than disabled: dead code that looks
  // like a guard is worse than no guard, because it reads as protection.

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

router.delete("/sites/:id", writeLimiter, requireScope("write"), asyncHandler(async (req, res) => {
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
