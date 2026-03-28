# Federation Protocol

This document specifies the **Nexus Hosting federation protocol** (`nexushosting/1.0`) — the mechanism by which independent nodes discover each other, verify cryptographic identity, and coordinate site replication.

---

## Goals

- **Decentralisation** — no central directory or trust authority
- **Cryptographic identity** — every node proves who it is with Ed25519 signatures
- **Resilience** — a node going offline does not take the network down
- **Simplicity** — the protocol is plain HTTP + JSON; any language can implement it

---

## Node Identity

Every node generates an **Ed25519 key pair** on first boot:

```ts
const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
```

The **public key** is published openly at `/.well-known/federation`.  
The **private key** never leaves the node — it lives only in the local database.

---

## Discovery

Any node can be discovered by fetching:

```
GET /.well-known/federation
```

Response:

```json
{
  "protocol": "nexushosting/1.0",
  "name": "My Node",
  "domain": "node1.example.com",
  "region": "us-east",
  "publicKey": "base64-encoded-ed25519-spki-key",
  "nodeCount": 5,
  "activeSites": 42,
  "joinedAt": "2025-01-01T00:00:00.000Z",
  "capabilities": [
    "site-hosting",
    "node-federation",
    "key-verification",
    "site-replication"
  ]
}
```

The `publicKey` field is the SPKI-encoded Ed25519 public key with PEM headers stripped and base64-encoded.

---

## Handshake Flow

Two nodes establish trust via a signed challenge-response:

```
Node A                                        Node B
  │                                               │
  │── GET /.well-known/federation ──────────────>│
  │<── { publicKey, capabilities, ... } ──────────│
  │                                               │
  │   localNode = A's domain                      │
  │   challenge = crypto.randomBytes(32).hex()    │
  │   timestamp = Date.now().toString()           │
  │   message   = `${localNode}:${challenge}:${timestamp}`
  │   signature = Ed25519.sign(privateKeyA, message)
  │                                               │
  │── POST /api/federation/ping ────────────────>│
  │   { nodeDomain: "A", challenge, signature,    │
  │     timestamp }                               │
  │                                               │
  │   Node B:                                     │
  │     1. Lookup A's public key in local DB      │
  │     2. Reconstruct message string             │
  │     3. Ed25519.verify(publicKeyA, message,    │
  │          signature)                           │
  │     4. If valid → set A.verifiedAt = now      │
  │     5. Emit { verified: true } + new challenge│
  │                                               │
  │<── { verified: true, challenge: "..." } ───────│
```

The handshake is **asymmetric by default** — only Node A pings Node B. For mutual verification, Node B should initiate its own handshake back to Node A using the new challenge returned in the response.

### Signature construction

```
message = `${senderDomain}:${challenge}:${timestamp}`
signature = Ed25519.sign(privateKey, Buffer.from(message))
```

The signature is base64-encoded in transit.

### Verification

```
Ed25519.verify(
  Buffer.from(signatureBase64, "base64"),
  Buffer.from(message),
  publicKey
)
```

---

## Site Sync

When a site is deployed, the originating node notifies all active peers:

```
POST /api/federation/sync
Content-Type: application/json
X-Federation-Signature: <base64 Ed25519 signature of the request body>

{
  "siteDomain": "my-blog.example.com",
  "deploymentId": 42,
  "timestamp": "1700000000000"
}
```

The signature covers the raw JSON body, signed with the originating node's private key. Receiving nodes:

1. Verify the signature against the sender's public key
2. Record the event in `federation_events` with `verified = 1 | 0`
3. (Future) Pull the site files from the originating node's object storage

Sync is **fire-and-forget** — a failed sync does not roll back the deploy. `Promise.allSettled` is used so a slow or offline peer cannot block the deployment response.

---

## Event Types

All federation activity is recorded in the `federation_events` table.

| `eventType` | Description |
|-------------|-------------|
| `handshake` | A full handshake was initiated (outcome recorded in `payload`) |
| `ping` | A ping was received and verified (or rejected) |
| `site_sync` | A site deployment notification was received from a peer |
| `node_offline` | A peer failed to respond and has been marked inactive |
| `key_rotation` | A node's Ed25519 key pair was rotated |

---

## Capabilities

Nodes advertise capabilities in the discovery document. Current capabilities:

| Capability | Description |
|------------|-------------|
| `site-hosting` | Can host and serve static sites |
| `node-federation` | Participates in the federation protocol |
| `key-verification` | Performs Ed25519 signature verification |
| `site-replication` | Accepts and records site sync notifications |

Future capabilities under consideration:

| Capability | Description |
|------------|-------------|
| `file-replication` | Pulls file bytes from peers after sync |
| `cdn-proxy` | Acts as a CDN edge for other nodes |
| `dynamic-routing` | Supports dynamic (non-static) site serving |

---

## Protocol Version

The current version is **`nexushosting/1.0`**. It is included in all discovery and ping responses. Future breaking changes will increment the major version. Nodes should check the `protocol` field before peering.

---

## Security Considerations

- **Replay attacks** — the `timestamp` field in signed messages should be validated. Reject messages where `|now - timestamp| > 60s`. *(Not yet enforced in v1.0 — planned for v1.1)*
- **Public key bootstrap** — the first time Node A trusts Node B's public key, it relies on DNS + TLS for initial trust. Operators should verify peer domains out-of-band.
- **Key rotation** — rotating keys (`POST /api/nodes/:id/generate-keys`) invalidates all existing verified relationships. Peers must re-handshake after a rotation.
- **Private key storage** — private keys are stored as PEM strings in the PostgreSQL database. For production deployments, consider encrypting at rest using a hardware security module or a secrets manager.

---

## Reference Implementation

All federation protocol logic lives in:

```
artifacts/api-server/src/lib/federation.ts   — key gen, sign, verify helpers
artifacts/api-server/src/routes/federation.ts — HTTP endpoints
artifacts/api-server/src/app.ts              — /.well-known/federation route
```
