import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  pgEnum,
  real,
  index,
} from "drizzle-orm/pg-core";
import { sitesTable } from "./sites";

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "pending",
  "active",
  "failed",
  "rolled_back",
]);

export const siteDeploymentsTable = pgTable("site_deployments", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id")
    .notNull()
    .references(() => sitesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  deployedBy: text("deployed_by"),
  status: deploymentStatusEnum("status").notNull().default("pending"),
  fileCount: integer("file_count").notNull().default(0),
  totalSizeMb: real("total_size_mb").notNull().default(0),
  deployedAt: timestamp("deployed_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("site_deployments_site_idx").on(t.siteId),
  index("site_deployments_status_idx").on(t.status),
]);

export const siteFilesTable = pgTable("site_files", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id")
    .notNull()
    .references(() => sitesTable.id, { onDelete: "cascade" }),
  deploymentId: integer("deployment_id"),
  filePath: text("file_path").notNull(),
  objectPath: text("object_path").notNull(),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  contentHash: text("content_hash"), // SHA-256 hex — enables dedup: same hash = same objectPath
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("site_files_site_idx").on(t.siteId),
  index("site_files_path_idx").on(t.siteId, t.filePath),
  index("site_files_deployment_idx").on(t.deploymentId),
  index("site_files_hash_idx").on(t.contentHash),
]);

export type SiteDeployment = typeof siteDeploymentsTable.$inferSelect;
export type SiteFile = typeof siteFilesTable.$inferSelect;
