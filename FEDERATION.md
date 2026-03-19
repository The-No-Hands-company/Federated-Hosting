# Federated Hosting — Federation Protocol Specification

**Protocol version:** `fedhost/1.0`  
**Status:** Draft  
**Last updated:** March 2026

---

## Overview

The Federated Hosting protocol allows independent nodes to form a verifiable, decentralized network for hosting static websites. Each node is cryptographically identified using Ed25519 key pairs. Nodes discover each other, verify identity through signed handshakes, and propagate site-deployment events across the network.

This document is implementation-language agnostic. A conforming node may be written in TypeScript, Rust, Go, or any other language.

---

## Node Identity

Every node generates a unique **Ed25519 key pair** on first initialization:

- The **private key** never leaves the node.
- The **public key** is published via the discovery endpoint and used by peers to verify signatures.
- Keys are stored as PEM-encoded strings. The raw base64 payload (without PEM headers) is used in API responses and signature verification.

### Key generation (reference)

```
Algorithm:   Ed25519
Format:      PKCS#8 private key, SPKI public key
Encoding:    PEM, base64 body extracted for wire format
```

---

## Discovery Endpoint

Every node **MUST** expose a discovery document at:

```
GET /.well-known/federation
```

### Response (JSON)

```json
{
  "protocol": "fedhost/1.0",
  "name": "My Hosting Node",
  "domain": "node.example.com",
  "region": "ap-southeast-1",
  "publicKey": "<base64-encoded SPKI public key, no PEM headers>",
  "nodeCount": 4,
  "activeSites": 12,
  "joinedAt": "2026-01-01T00:00:00Z",
  "capabilities": [
    "site-hosting",
    "node-federation",
    "key-verification",
    "site-replication"
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `protocol` | yes | Must be `fedhost/1.0` |
| `name` | yes | Human-readable node name |
| `domain` | yes | Canonical domain of this node |
| `region` | yes | Geographic region (free-form string) |
| `publicKey` | yes | Base64 SPKI Ed25519 public key |
| `nodeCount` | no | Number of known peers |
| `activeSites` | no | Number of currently active site deployments |
| `joinedAt` | yes | ISO 8601 timestamp of node creation |
| `capabilities` | yes | Array of capability strings |

---

## Request Signing

All federation-to-federation requests **MUST** be signed using the sending node's Ed25519 private key.

### Signature construction

1. Serialize the request body to a canonical JSON string (no extra whitespace).
2. Encode as UTF-8 bytes.
3. Sign with Ed25519 private key → produces a 64-byte signature.
4. Base64-encode the signature.
5. Set the `X-Federation-Signature` HTTP header to the base64 signature.

### Verification

The receiving node:
1. Looks up the sender's public key (from its peer registry or from `/.well-known/federation`).
2. Re-serializes the received body bytes.
3. Verifies the `X-Federation-Signature` header against the body using the sender's public key.
4. Rejects the request with `401 Unauthorized` if verification fails.

---

## Handshake Protocol

To join the federation, a node initiates a handshake with a known peer.

### Step 1 — Initiate handshake

```
POST /api/federation/handshake
Content-Type: application/json

{
  "targetDomain": "peer.example.com"
}
```

The initiating node:
1. Fetches `https://peer.example.com/.well-known/federation` to retrieve the peer's public key.
2. Constructs a signed ping payload.
3. Sends `POST /api/federation/ping` to the peer.

### Step 2 — Receive ping

```
POST /api/federation/ping
Content-Type: application/json
X-Federation-Signature: <base64>

{
  "fromDomain": "initiator.example.com",
  "publicKey": "<base64 SPKI key>",
  "timestamp": "2026-01-01T00:00:00Z",
  "nonce": "<random uuid>"
}
```

The receiving node:
1. Verifies the signature using `publicKey` from the payload (or cached peer registry).
2. Checks `timestamp` is within ±5 minutes (replay protection).
3. Registers the sender as a verified peer, recording `verifiedAt`.
4. Returns `200 OK` with its own identity.

### Ping response

```json
{
  "ok": true,
  "name": "Receiving Node",
  "domain": "peer.example.com",
  "publicKey": "<base64 SPKI key>"
}
```

---

## Peer Registry

Nodes maintain a local registry of known federation peers.

```
GET /api/federation/peers
```

Returns a paginated list of known peers with their last-verified timestamp and status.

---

## Site Sync Notification

When a site is deployed (files uploaded and activated), the deploying node notifies all active peers.

```
POST /api/federation/notify-sync
Content-Type: application/json
X-Federation-Signature: <base64>

{
  "eventType": "site_sync",
  "siteDomain": "mysite.example.com",
  "version": 3,
  "fileCount": 12,
  "totalSizeMb": 1.4,
  "fromDomain": "source-node.example.com",
  "timestamp": "2026-01-01T00:00:00Z"
}
```

Receiving nodes **SHOULD**:
1. Verify the signature.
2. Log the event in their local `federation_events` table.
3. Optionally mirror the deployment if they are a designated replica.

---

## Federation Events

All federation activity is persisted in a local event log.

```
GET /api/federation/events?page=1&limit=50
```

### Event types

| Type | Description |
|------|-------------|
| `handshake` | A node initiated a handshake |
| `ping` | A signed ping was received and verified |
| `site_sync` | A site deployment notification was received |
| `offline` | A peer failed health checks |
| `key_rotation` | A node rotated its Ed25519 key pair |

---

## Capacity API

Nodes expose their resource capacity so the network can balance load.

```
GET /api/capacity/summary         — Network-wide totals
GET /api/nodes/:id/capacity       — Per-node storage breakdown
POST /api/nodes/:id/update-capacity  — Update node's capacity figures
```

---

## Security Considerations

1. **Replay attacks** — Implementations MUST reject ping/sync messages with a `timestamp` outside a 5-minute window.
2. **Key rotation** — Nodes MAY rotate their Ed25519 key pair. After rotation, the new public key is published via `/.well-known/federation`. Peers SHOULD re-verify after key rotation events.
3. **Defederation** — Nodes MAY maintain a defederation list (blocked domains). Requests from blocked domains are rejected with `403 Forbidden`.
4. **Upload sandboxing** — Uploaded files are stored as static assets only. No server-side execution of uploaded JavaScript is permitted.
5. **Rate limiting** — All federation endpoints SHOULD apply rate limiting. Recommended: 60 requests/minute per IP.
6. **TLS** — All inter-node communication MUST use HTTPS. Plain HTTP federation connections SHOULD be rejected.

---

## Capability Strings

| Capability | Description |
|------------|-------------|
| `site-hosting` | Node can host and serve static websites |
| `node-federation` | Node participates in the federation protocol |
| `key-verification` | Node verifies Ed25519 signatures |
| `site-replication` | Node can mirror deployments from peers |
| `low-resource` | Node is optimized for low-RAM/bandwidth environments |
| `ipfs-pinning` | Node pins content to IPFS (future) |

---

## Interoperability Notes

- Implementations in any language are welcome. The wire format is JSON over HTTPS.
- The Ed25519 signing algorithm is standardized (RFC 8032). Standard libraries in Rust (`ed25519-dalek`), Go (`crypto/ed25519`), Python (`cryptography`), and Node.js (`crypto`) all produce compatible signatures.
- Future versions of this spec will be versioned as `fedhost/1.1`, `fedhost/2.0`, etc. Nodes SHOULD advertise the highest version they support.

---

## Reference Implementation

TypeScript/Node.js: [`artifacts/api-server/src/lib/federation.ts`](artifacts/api-server/src/lib/federation.ts)

Federation routes: [`artifacts/api-server/src/routes/federation.ts`](artifacts/api-server/src/routes/federation.ts)
