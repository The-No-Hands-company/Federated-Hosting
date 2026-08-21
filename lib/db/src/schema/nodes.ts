import { pgTable, text, serial, timestamp, real, integer, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// "pending" is a node that has been created but has not yet proven it holds a
// key. It exists so a node can be enrolled without the server ever minting its
// identity: the row is created first, empty of keys, and the operator's machine
// supplies the public half when it claims the enrolment token.
//
// Before this, a node was born "active" with a server-generated keypair whose
// private half was written to this table. Anyone with the database could
// impersonate every node it had issued, and the operator had no way to know
// their key had ever existed anywhere but their own machine.
export const nodeStatusEnum = pgEnum("node_status", ["pending", "active", "inactive", "maintenance"]);

export const nodesTable = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull().unique(),
  description: text("description"),
  status: nodeStatusEnum("status").notNull().default("active"),
  region: text("region").notNull(),
  operatorName: text("operator_name").notNull(),
  operatorEmail: text("operator_email").notNull(),
  storageCapacityGb: real("storage_capacity_gb").notNull(),
  bandwidthCapacityGb: real("bandwidth_capacity_gb").notNull(),
  uptimePercent: real("uptime_percent").notNull().default(100),
  siteCount: integer("site_count").notNull().default(0),
  publicKey: text("public_key"),
  privateKey: text("private_key"),
  isLocalNode: integer("is_local_node").default(0),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (t) => [
  index("nodes_status_idx").on(t.status),
  index("nodes_local_idx").on(t.isLocalNode),
]);

export const insertNodeSchema = createInsertSchema(nodesTable).omit({
  id: true,
  joinedAt: true,
  siteCount: true,
  uptimePercent: true,
});
export type InsertNode = z.infer<typeof insertNodeSchema>;
export type Node = typeof nodesTable.$inferSelect;
