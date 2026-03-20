import { pgTable, serial, integer, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { sitesTable } from "./sites";

export const siteEnvVarsTable = pgTable("site_env_vars", {
  id:        serial("id").primaryKey(),
  siteId:    integer("site_id").notNull().references(() => sitesTable.id, { onDelete: "cascade" }),
  key:       text("key").notNull(),
  value:     text("value").notNull(),
  secret:    integer("secret").notNull().default(0), // 1 = masked in API responses
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("site_env_vars_site_idx").on(t.siteId),
  unique("site_env_vars_unique").on(t.siteId, t.key),
]);
