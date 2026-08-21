import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { serializeDates } from "../lib/serialize";
import { asyncHandler, AppError } from "../lib/errors";
import { writeLimiter } from "../middleware/rateLimiter";

const router: IRouter = Router();

/** One page. Enough to scroll, small enough not to ship a year of history. */
const PAGE = 50;

/**
 * A signed-in user's own notifications.
 *
 * Every route here is scoped to the caller by user_id, with no parameter that
 * could widen it. There is deliberately no way to read or mark somebody else's
 * — a notification can name a site, a failure or a peer, and none of that is
 * any other account's business.
 */
router.get("/notifications", asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const unreadOnly = req.query.unread === "true";
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(
      unreadOnly
        ? and(eq(notificationsTable.userId, req.user.id), isNull(notificationsTable.readAt))
        : eq(notificationsTable.userId, req.user.id),
    )
    .orderBy(desc(notificationsTable.createdAt))
    .limit(PAGE);

  res.json({ notifications: rows.map(serializeDates) });
}));

/**
 * How many are unread.
 *
 * Its own endpoint because the badge polls and the list does not: sending 50
 * rows every few seconds to render a number would be wasteful, and a count
 * query answers from the (user_id, read_at) index without touching the rows.
 */
router.get("/notifications/unread-count", asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, req.user.id), isNull(notificationsTable.readAt)));

  res.json({ unread: row?.count ?? 0 });
}));

router.post("/notifications/:id/read", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw AppError.badRequest("Invalid notification id.");

  // The user_id predicate is the authorisation, not a filter. Without it this
  // marks anybody's notification read for anyone who can guess an integer.
  const updated = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, req.user.id)))
    .returning({ id: notificationsTable.id });

  // 404 rather than 403 for someone else's row: confirming it exists tells a
  // guesser they found a real one.
  if (updated.length === 0) throw AppError.notFound("Notification not found.");

  res.json({ ok: true });
}));

router.post("/notifications/read-all", writeLimiter, asyncHandler(async (req, res) => {
  if (!req.isAuthenticated()) throw AppError.unauthorized();

  const updated = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(and(eq(notificationsTable.userId, req.user.id), isNull(notificationsTable.readAt)))
    .returning({ id: notificationsTable.id });

  res.json({ marked: updated.length });
}));

export default router;
