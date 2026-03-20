import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const adminAuditLogTable = pgTable("admin_audit_log", {
  id:         serial("id").primaryKey(),
  actorId:    text("actor_id").notNull(),
  actorEmail: text("actor_email"),
  action:     text("action").notNull(),
  targetType: text("target_type"),
  targetId:   text("target_id"),
  before:     text("before"),   // JSON string of previous state
  after:      text("after"),    // JSON string of new state
  ip:         text("ip"),
  userAgent:  text("user_agent"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_log_actor_idx").on(t.actorId),
  index("audit_log_action_idx").on(t.action),
  index("audit_log_created_idx").on(t.createdAt),
]);
