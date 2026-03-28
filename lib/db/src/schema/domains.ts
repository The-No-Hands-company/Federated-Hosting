import { pgTable, serial, integer, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { sitesTable } from "./sites";

export const domainVerificationStatusEnum = pgEnum("domain_verification_status", [
  "pending",
  "verified",
  "failed",
]);

/**
 * Custom domains attached to a site (beyond the default *.nexushosting domain).
 * Users add a CNAME record + TXT verification record to prove domain ownership.
 */
export const customDomainsTable = pgTable("custom_domains", {
  id: serial("id").primaryKey(),
  siteId: integer("site_id")
    .notNull()
    .references(() => sitesTable.id, { onDelete: "cascade" }),
  /** The custom domain the user wants to attach, e.g. "mysite.com" */
  domain: text("domain").notNull().unique(),
  /** Random hex token the user must place in a TXT record at _fh-verify.<domain> */
  verificationToken: text("verification_token").notNull(),
  status: domainVerificationStatusEnum("status").notNull().default("pending"),
  /** When the domain was last verified via DNS lookup */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  /** Last DNS check attempt */
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  /** Human-readable error from the last failed verification attempt */
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("custom_domains_site_idx").on(t.siteId),
  index("custom_domains_domain_idx").on(t.domain),
  index("custom_domains_status_idx").on(t.status),
]);

export type CustomDomain = typeof customDomainsTable.$inferSelect;
