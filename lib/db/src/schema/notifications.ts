import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

/**
 * What the system has to tell a person.
 *
 * This is not a convenience feature on this node. Outbound email does not work
 * and cannot be made to — port 25 is blocked by the ISP, there is no IPv6, and
 * a relay would be a third party (see docs/EMAIL-DNS.md). So an in-app
 * notification is the *only* way anything here can reach a user. Before this,
 * a site going down, a deploy failing or a peer joining was either silent or
 * went to an external webhook nobody had configured.
 *
 * Rows are written by deliverWebhook, which every emitter already funnels
 * through. That means notifications are a second sink on an event spine that
 * exists rather than a parallel one to keep in step, and any future event that
 * learns to call deliverWebhook gets notifications for nothing.
 */
export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),

  /** Who should see it. Text, because users.id is a varchar UUID. */
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  /** A WebhookEventType value: deploy_failed, site_down, new_peer, … */
  event: text("event").notNull(),

  /** One line, written to be readable in a list without opening it. */
  title: text("title").notNull(),

  /** Optional detail. Absent is fine — many events say everything in a title. */
  body: text("body"),

  /**
   * Where to go to act on it, as a dashboard-relative path. Null when there is
   * nothing to open, which is honest: a link to nowhere is worse than none.
   */
  href: text("href"),

  /** Null until read. A timestamp rather than a flag, so "when" survives. */
  readAt: timestamp("read_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The list query is "mine, newest first", and the badge is "mine, unread".
  // Both are served by this one index.
  index("notifications_user_time_idx").on(t.userId, t.createdAt),
  index("notifications_unread_idx").on(t.userId, t.readAt),
]);
