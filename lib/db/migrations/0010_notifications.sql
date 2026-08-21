-- What the system has to tell a person.
--
-- Not a convenience on this node: outbound email is impossible here (port 25
-- blocked, no IPv6, a relay would be third-party — see docs/EMAIL-DNS.md), so
-- an in-app notification is the only channel the system has. Site down, deploy
-- failed, peer joined — all of it was silent before this.
CREATE TABLE IF NOT EXISTS "notifications" (
    "id"         serial PRIMARY KEY NOT NULL,
    -- text, matching users.id which is a varchar UUID. Declaring this integer
    -- is the mistake migration 0008 nearly shipped.
    "user_id"    text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "event"      text NOT NULL,
    "title"      text NOT NULL,
    "body"       text,
    "href"       text,
    "read_at"    timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- "mine, newest first" for the list; "mine, unread" for the badge.
CREATE INDEX IF NOT EXISTS "notifications_user_time_idx"
    ON "notifications" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
    ON "notifications" ("user_id", "read_at");
