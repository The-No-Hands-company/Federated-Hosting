import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { sitesTable } from "./sites";

/**
 * History of site health checks.
 *
 * lib/siteHealthMonitor.ts wrote to a `siteHealthChecksTable` that had never
 * been defined, so the module could not compile — and nothing imports it, so
 * nobody noticed. The columns here are exactly the ones that insert supplies.
 *
 * Rows are append-only and are the record behind "was the site up last
 * Tuesday", so they outlive the in-memory map the monitor keeps for
 * transition detection.
 */
export const siteHealthChecksTable = pgTable("site_health_checks", {
  id: serial("id").primaryKey(),

  siteId: integer("site_id")
    .notNull()
    .references(() => sitesTable.id, { onDelete: "cascade" }),

  /** "up" | "down" | "degraded", as reported by the monitor. */
  status: text("status").notNull(),

  /** HTTP status observed, or null when the request never completed. */
  httpStatus: integer("http_status"),

  /** Round-trip time in milliseconds, null on failure. */
  responseMs: integer("response_ms"),

  /** Failure detail, null on success. */
  error: text("error"),

  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // The common query is "recent checks for this site", newest first.
  index("site_health_checks_site_time_idx").on(t.siteId, t.checkedAt),
]);
