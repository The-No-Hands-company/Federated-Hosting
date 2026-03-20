import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const webhookDeliveriesTable = pgTable("webhook_deliveries", {
  id:         serial("id").primaryKey(),
  webhookId:  integer("webhook_id").notNull(),
  event:      text("event").notNull(),
  payload:    jsonb("payload").notNull(),
  statusCode: integer("status_code"),
  response:   text("response"),
  attempt:    integer("attempt").notNull().default(1),
  durationMs: integer("duration_ms"),
  success:    integer("success").notNull().default(0),
  nextRetry:  timestamp("next_retry", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("webhook_deliveries_webhook_idx").on(t.webhookId),
  index("webhook_deliveries_retry_idx").on(t.nextRetry),
]);
