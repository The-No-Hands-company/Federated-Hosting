import { eq, lt, sql } from "drizzle-orm";
import { db, notificationsTable, sitesTable, usersTable } from "@workspace/db";
import type { WebhookPayload } from "./webhooks";
import logger from "./logger";

/**
 * Turning system events into things a person sees.
 *
 * Every emitter in this service already funnels through deliverWebhook, so
 * this hangs off that rather than introducing a second event path to keep in
 * step. deliverWebhook sends to external URLs; this writes rows for the humans
 * who should know.
 *
 * That distinction matters here more than it usually would: outbound email is
 * impossible on this node (docs/EMAIL-DNS.md), so these rows are the only way
 * the system can tell anyone anything at all.
 */

/** Keep 90 days. Long enough to look back, short enough not to grow forever. */
const RETENTION_DAYS = 90;

/** And a hard ceiling per user, so one noisy site cannot bury everything else. */
const MAX_PER_USER = 500;

type Rendered = { title: string; body?: string; href?: string };

/**
 * How each event reads in a list.
 *
 * Written as full sentences rather than "deploy_failed" — the point of this
 * table is that a person understands it at a glance, and an event name is not
 * a sentence.
 */
export function render(p: WebhookPayload): Rendered | null {
  const site = p.siteDomain ? String(p.siteDomain) : "a site";
  const node = p.nodeDomain ? String(p.nodeDomain) : "a node";

  switch (p.event) {
    case "deploy":
      return {
        title: `${site} deployed`,
        body: p.version ? `Version ${p.version} is live.` : undefined,
        href: p.siteId ? `/sites/${p.siteId}` : undefined,
      };
    case "deploy_failed":
      return {
        title: `Deploy failed for ${site}`,
        body: "The previous version is still serving.",
        href: p.siteId ? `/sites/${p.siteId}` : undefined,
      };
    case "site_down":
      return { title: `${site} is not responding`, href: p.siteId ? `/sites/${p.siteId}` : undefined };
    case "site_recovered":
      return { title: `${site} is back up`, href: p.siteId ? `/sites/${p.siteId}` : undefined };
    case "node_offline":
      return { title: `Peer ${node} went offline`, href: "/federation" };
    case "node_online":
      return { title: `Peer ${node} is online`, href: "/federation" };
    case "new_peer":
      return { title: `${node} joined the federation`, href: "/federation" };
    case "form_submission":
      return { title: `New form submission on ${site}`, href: p.siteId ? `/sites/${p.siteId}/forms` : undefined };
    default:
      // An event nobody has written a sentence for is not worth showing as a
      // raw enum. Returning null drops it rather than surfacing gibberish.
      return null;
  }
}

/**
 * Who should see it.
 *
 * Site events go to the site's owner. Everything else is about the node, which
 * on a single-operator install means the admins. Admins also receive site
 * events they do not own — on a node run by one person, not being told your
 * own site failed because you are not technically its owner would be absurd.
 */
async function recipients(p: WebhookPayload): Promise<string[]> {
  const ids = new Set<string>();

  if (p.siteId) {
    const [site] = await db
      .select({ ownerId: sitesTable.ownerId })
      .from(sitesTable)
      .where(eq(sitesTable.id, Number(p.siteId)));
    if (site?.ownerId) ids.add(site.ownerId);
  }

  const admins = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    // is_admin is an integer flag, not a boolean — the same shape that made
    // migration 0008's created_by column wrong. Comparing against `true` here
    // does not typecheck, which is the check doing its job.
    .where(eq(usersTable.isAdmin, 1));
  for (const a of admins) ids.add(a.id);

  return [...ids];
}

/**
 * Record an event for everyone who should know.
 *
 * Never throws. A notification failing must not fail the deploy, the health
 * check or the webhook that produced it — the event already happened, and
 * losing the note about it is strictly better than losing the thing itself.
 */
export async function notify(p: WebhookPayload): Promise<void> {
  try {
    const rendered = render(p);
    if (!rendered) return;

    const targets = await recipients(p);
    if (targets.length === 0) {
      // An event that renders fine and reaches nobody is the failure mode
      // this whole module exists to avoid, and it is invisible from the
      // outside: the emitter succeeded, no error was thrown, and the row was
      // simply never written.
      //
      // Measured on this node 2026-08-21: zero users had is_admin=1, so every
      // node_online / node_offline / new_peer would have vanished silently,
      // and two sites had an owner_id matching no user. Nothing in the code
      // was wrong — there was just nobody to tell, which is exactly the state
      // an operator needs to be able to discover.
      logger.warn(
        { event: p.event, siteId: p.siteId ?? null },
        "[notify] event had no recipients — no admin users, or the site has no owner",
      );
      return;
    }

    await db.insert(notificationsTable).values(
      targets.map((userId) => ({
        userId,
        event: p.event,
        title: rendered.title,
        body: rendered.body ?? null,
        href: rendered.href ?? null,
      })),
    );
  } catch (err) {
    logger.warn({ err, event: p.event }, "[notify] could not record notification");
  }
}

/**
 * Trim old and excess notifications.
 *
 * Called on a timer. Without it this table is unbounded, and the first thing
 * anyone notices is a slow dashboard rather than a full disk.
 */
export async function pruneNotifications(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const old = await db
    .delete(notificationsTable)
    .where(lt(notificationsTable.createdAt, cutoff))
    .returning({ id: notificationsTable.id });

  // Then the per-user ceiling, oldest first. Read notifications go before
  // unread ones of the same age would — an unread note is still doing its job.
  const overflow = await db.execute(sql`
    DELETE FROM notifications WHERE id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (
          PARTITION BY user_id ORDER BY read_at IS NULL DESC, created_at DESC
        ) AS rn
        FROM notifications
      ) ranked WHERE rn > ${MAX_PER_USER}
    )
  `);

  return old.length + (overflow.rowCount ?? 0);
}

export { RETENTION_DAYS, MAX_PER_USER };
