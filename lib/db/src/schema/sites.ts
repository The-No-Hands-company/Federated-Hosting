import { pgTable, text, serial, timestamp, real, integer, bigint, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const siteStatusEnum = pgEnum("site_status", ["active", "suspended", "migrating", "maintenance"]);
export const siteTypeEnum = pgEnum("site_type", ["static", "dynamic", "blog", "portfolio", "other", "nlpl"]);
export const siteVisibilityEnum = pgEnum("site_visibility", ["public", "private", "password"]);

export const sitesTable = pgTable("sites", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  description: text("description"),
  status: siteStatusEnum("status").notNull().default("active"),
  siteType: siteTypeEnum("site_type").notNull().default("static"),
  ownerName: text("owner_name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  ownerId: text("owner_id"),
  primaryNodeId: integer("primary_node_id"),
  replicaCount: integer("replica_count").notNull().default(1),
  storageUsedMb: real("storage_used_mb").notNull().default(0),
  monthlyBandwidthGb: real("monthly_bandwidth_gb").notNull().default(0),
  hitCount: bigint("hit_count", { mode: "number" }).notNull().default(0),
  lastHitAt: timestamp("last_hit_at", { withTimezone: true }),
  /** public | private | password */
  visibility: siteVisibilityEnum("visibility").notNull().default("public"),
  /** bcrypt hash — only set when visibility = 'password' */
  passwordHash:  text("password_hash"),
  unlockMessage:      text("unlock_message"),
  maintenanceMessage: text("maintenance_message"),
  /** SPA routing: serve index.html for any unknown path (true = SPA, false = strict 404) */
  spaRouting: integer("spa_routing").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("sites_owner_idx").on(t.ownerId),
  index("sites_status_idx").on(t.status),
  index("sites_primary_node_idx").on(t.primaryNodeId),
]);

export const insertSiteSchema = createInsertSchema(sitesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  replicaCount: true,
  storageUsedMb: true,
  monthlyBandwidthGb: true,
  hitCount: true,
  lastHitAt: true,
});
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Site = typeof sitesTable.$inferSelect;
