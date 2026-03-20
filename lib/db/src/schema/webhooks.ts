import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { sitesTable } from "./sites";

export const webhooksTable = pgTable("webhooks", {
  id:        serial("id").primaryKey(),
  siteId:    integer("site_id").notNull().references(() => sitesTable.id, { onDelete: "cascade" }),
  url:       text("url").notNull(),
  secret:    text("secret"),
  events:    text("events").notNull().default("*"), // comma-separated event names or '*' for all
  enabled:   integer("enabled").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("webhooks_site_idx").on(t.siteId),
]);
