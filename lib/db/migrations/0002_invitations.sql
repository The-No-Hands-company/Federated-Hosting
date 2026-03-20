CREATE TABLE IF NOT EXISTS "site_invitations" (
  "id"              SERIAL PRIMARY KEY,
  "site_id"         INTEGER NOT NULL REFERENCES "sites"("id") ON DELETE CASCADE,
  "invited_by"      TEXT    NOT NULL REFERENCES "users"("id"),
  "email"           TEXT    NOT NULL,
  "role"            "site_member_role" NOT NULL DEFAULT 'viewer',
  "token"           TEXT    NOT NULL UNIQUE,
  "accepted_at"     TIMESTAMP WITH TIME ZONE,
  "expires_at"      TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "invitations_site_idx"  ON "site_invitations"("site_id");
CREATE INDEX IF NOT EXISTS "invitations_email_idx" ON "site_invitations"("email");
CREATE INDEX IF NOT EXISTS "invitations_token_idx" ON "site_invitations"("token");
