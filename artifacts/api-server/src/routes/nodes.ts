import { Router, type IRouter } from "express";
import { eq, count, ilike, or } from "drizzle-orm";
import { db, nodesTable } from "@workspace/db";
import {
  CreateNodeBody,
  UpdateNodeBody,
  UpdateNodeParams,
  GetNodeParams,
  DeleteNodeParams,
  GetNodeResponse,
  UpdateNodeResponse,
} from "@workspace/api-zod";
import { serializeDates } from "../lib/serialize";
import { asyncHandler, AppError } from "../lib/errors";
import { parsePagination, buildPaginatedResponse } from "../lib/pagination";
import { writeLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

router.get("/nodes", asyncHandler(async (req, res) => {
  const { limit, offset, page } = parsePagination(req);
  const statusFilter = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;

  const whereClause = statusFilter
    ? eq(nodesTable.status, statusFilter as "active" | "inactive" | "maintenance")
    : search
    ? or(ilike(nodesTable.name, `%${search}%`), ilike(nodesTable.domain, `%${search}%`))
    : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(nodesTable)
    .where(whereClause);

  const nodes = await db
    .select()
    .from(nodesTable)
    .where(whereClause)
    .orderBy(nodesTable.joinedAt)
    .limit(limit)
    .offset(offset);

  // operatorEmail goes with privateKey. GET /nodes is unauthenticated — it is
  // the federation directory — so every listing was handing out the operator's
  // email address to anyone who asked. Discovery needs the domain and the
  // public key, never a person's contact details. publicKey stays: signed
  // handshakes are the point of it.
  const safeNodes = nodes.map(
    ({ privateKey: _pk, operatorEmail: _oe, ...node }) => node,
  );
  res.json(buildPaginatedResponse(serializeDates(safeNodes), Number(total), { limit, offset, page }));
}));

router.post("/nodes", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const parsed = CreateNodeBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  // This used to generate a keypair when the caller supplied no publicKey, and
  // write the private half to the nodes table. A federation node's private key
  // is its identity, so that database could impersonate every node it had
  // minted, and the operator had no way to know their key had ever existed
  // outside their own machine.
  //
  // Nothing here mints identities any more. A caller that already holds a key
  // may register its public half directly; a caller that does not should use
  // POST /nodes/enroll, which issues a single-use token for the installer to
  // redeem after generating a key on the node itself.
  if (!parsed.data.publicKey) {
    throw AppError.badRequest(
      "publicKey is required. This service does not generate node keys — a node's private key must never leave the machine it identifies. Use POST /nodes/enroll to get an enrolment token and run the installer on the node.",
    );
  }

  const [node] = await db
    .insert(nodesTable)
    .values({
      ...parsed.data,
      publicKey: parsed.data.publicKey,
      privateKey: null,
      lastSeenAt: new Date(),
    })
    .returning();

  const { privateKey: _pk, ...safeNode } = node;
  res.status(201).json(GetNodeResponse.parse(serializeDates(safeNode)));
}));

router.get("/nodes/:id", asyncHandler(async (req, res) => {
  const params = GetNodeParams.safeParse(req.params);
  if (!params.success) throw AppError.badRequest(params.error.message);

  const [node] = await db.select().from(nodesTable).where(eq(nodesTable.id, params.data.id));
  if (!node) throw AppError.notFound(`Node ${params.data.id} not found`);

  const { privateKey: _pk, ...safeNode } = node;
  // Validated against the schema, then the email is dropped before it goes
  // out. The generated schema still marks operatorEmail required — openapi.yaml
  // no longer does, but orval cannot regenerate right now (see the note in
  // lib/api-spec). Parsing first keeps the contract check honest; stripping
  // after keeps the address unpublished.
  const { operatorEmail: _oe, ...publicNode } = GetNodeResponse.parse(
    serializeDates(safeNode),
  );
  res.json(publicNode);
}));

router.patch("/nodes/:id", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const params = UpdateNodeParams.safeParse(req.params);
  if (!params.success) throw AppError.badRequest(params.error.message);

  const parsed = UpdateNodeBody.safeParse(req.body);
  if (!parsed.success) throw AppError.badRequest(parsed.error.message);

  const [node] = await db
    .update(nodesTable)
    .set(parsed.data)
    .where(eq(nodesTable.id, params.data.id))
    .returning();

  if (!node) throw AppError.notFound(`Node ${params.data.id} not found`);

  const { privateKey: _pk, ...safeNode } = node;
  res.json(UpdateNodeResponse.parse(serializeDates(safeNode)));
}));

router.delete("/nodes/:id", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const params = DeleteNodeParams.safeParse(req.params);
  if (!params.success) throw AppError.badRequest(params.error.message);

  const [node] = await db.delete(nodesTable).where(eq(nodesTable.id, params.data.id)).returning();
  if (!node) throw AppError.notFound(`Node ${params.data.id} not found`);
  res.sendStatus(204);
}));

export default router;
