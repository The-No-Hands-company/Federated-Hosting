import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { nodesTable } from "./nodes";
import { usersTable } from "./auth";

/**
 * Single-use tokens that let a machine claim a pending node.
 *
 * The flow this exists for: an operator creates a node in the dashboard, gets
 * one token, and runs the installer on the machine that will actually be the
 * node. The installer generates an Ed25519 keypair *there*, signs the token
 * with the private half to prove it holds it, and sends only the public half
 * back. The private key never leaves the operator's machine and is never
 * transmitted, so it cannot be stored here even by accident.
 *
 * Only a hash of the token is kept. site_invitations stores its token in
 * plaintext, which means a read of that table yields working invitations; this
 * table is the same shape without that property. A token is shown to the
 * operator exactly once, at creation, and cannot be recovered afterwards —
 * losing it means revoking and issuing another, which is the correct tradeoff
 * for a credential that enrols a federation peer.
 */
export const nodeEnrollmentTokensTable = pgTable("node_enrollment_tokens", {
  id: serial("id").primaryKey(),

  nodeId: integer("node_id")
    .notNull()
    .references(() => nodesTable.id, { onDelete: "cascade" }),

  /** SHA-256 of the token, hex. The token itself is never stored. */
  tokenHash: text("token_hash").notNull().unique(),

  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  /** Set when redeemed. A token with this set is spent and never valid again. */
  claimedAt: timestamp("claimed_at", { withTimezone: true }),

  /** Set when an operator revokes the token before it is used. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("node_enrollment_tokens_node_idx").on(t.nodeId),
  index("node_enrollment_tokens_hash_idx").on(t.tokenHash),
]);
