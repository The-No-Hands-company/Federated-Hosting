-- Node enrolment: a node proves it holds a key instead of being handed one.
--
-- Before this, POST /nodes generated an Ed25519 keypair server-side whenever a
-- caller supplied no publicKey, and wrote the private half to nodes.private_key.
-- A federation node's private key is its identity, so that column let this
-- database impersonate every node it had issued — and the operator had no way
-- to know their key had ever existed outside their own machine. Only the local
-- node's key is ever read (signMessage uses localNode.privateKey and nothing
-- else); every remote node's stored private key was liability with no function.
--
-- Two changes support the replacement flow.

-- 1. A node can now exist before it has a key.
--
-- ALTER TYPE ... ADD VALUE is transaction-safe from PostgreSQL 12 onward, and
-- the migration runner wraps each file in BEGIN/COMMIT. The new value is not
-- *used* anywhere below, which is the remaining restriction — a value added in
-- a transaction cannot be referenced until that transaction commits.
ALTER TYPE "node_status" ADD VALUE IF NOT EXISTS 'pending';

-- 2. Single-use tokens that let a machine claim a pending node.
--
-- token_hash, not token. site_invitations stores its tokens in plaintext, so
-- reading that table yields working invitations; this table deliberately does
-- not have that property. A token is shown once at creation and is otherwise
-- unrecoverable, which is the right trade for a credential that enrols a peer
-- into the federation.
CREATE TABLE IF NOT EXISTS "node_enrollment_tokens" (
    "id"          serial PRIMARY KEY NOT NULL,
    "node_id"     integer NOT NULL REFERENCES "nodes"("id") ON DELETE CASCADE,
    "token_hash"  text NOT NULL UNIQUE,
    "created_by"  integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "expires_at"  timestamp with time zone NOT NULL,
    "claimed_at"  timestamp with time zone,
    "revoked_at"  timestamp with time zone,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "node_enrollment_tokens_node_idx"
    ON "node_enrollment_tokens" ("node_id");

-- Every claim looks a token up by hash, so this index is on the hot path of
-- the only unauthenticated write endpoint in the enrolment flow.
CREATE INDEX IF NOT EXISTS "node_enrollment_tokens_hash_idx"
    ON "node_enrollment_tokens" ("token_hash");
