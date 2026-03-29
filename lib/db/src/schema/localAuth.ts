import { pgTable, serial, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Local auth credentials — email + password alongside OIDC.
 *
 * Allows node operators to let users register without requiring
 * an external OIDC provider (Authentik/Keycloak/Auth0).
 *
 * Enabled by default. Disable by setting LOCAL_AUTH_ENABLED=false.
 */

export const localAuthTable = pgTable("local_auth", {
  id:           serial("id").primaryKey(),
  userId:       varchar("user_id").notNull().unique(),
  email:        varchar("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("local_auth_email_idx").on(t.email),
]);

export const passwordResetTokensTable = pgTable("password_reset_tokens", {
  id:        serial("id").primaryKey(),
  userId:    varchar("user_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt:    timestamp("used_at",    { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("pwd_reset_token_idx").on(t.tokenHash),
]);

export type LocalAuth         = typeof localAuthTable.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
