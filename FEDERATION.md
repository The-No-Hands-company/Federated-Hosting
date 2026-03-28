# Nexus Hosting — Federation Protocol Specification

**Protocol version:** `nexushosting/1.0`  
**Status:** Draft  
**Last updated:** March 2026

---

## Overview

The Nexus Hosting protocol allows independent nodes to form a verifiable, decentralized network for hosting static websites. Each node is cryptographically identified using Ed25519 key pairs. Nodes discover each other, verify identity through signed handshakes, and propagate site-deployment events across the network.

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
  "protocol": "nexushosting/1.0",
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
| `protocol` | yes | Must be `nexushosting/1.0` |
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
X-Federation-Signature: <base64url>

{
  "nodeDomain": "initiator.example.com",
  "challenge":  "c2FtcGxlY2hhbGxlbmdlc3RyaW5n",
  "signature":  "base64url-encoded-ed25519-signature",
  "timestamp":  "1735689600000"
}
```

**Signature construction** (exact bytes signed):

```
message = "{nodeDomain}:{challenge}:{timestamp}"
         = "initiator.example.com:c2FtcGxlY2hhbGxlbmdlc3RyaW5n:1735689600000"
signature = Ed25519.sign(privateKey, UTF8(message))
```

The receiving node:
1. Verifies the signature using the sender's public key (fetched from `/.well-known/federation`).
2. Checks `timestamp` is within ±5 minutes (replay protection).
3. Registers the sender as a verified peer, recording `verifiedAt`.
4. Returns `200 OK` with its own identity.

### Ping response

```json
{
  "ok": true,
  "name": "Receiving Node",
  "domain": "peer.example.com",
  "region": "ap-southeast-3",
  "publicKey": "MCowBQYDK2VdAyEA..."
}
```

### Discovery endpoint wire format

```
GET https://peer.example.com/.well-known/federation
```

```json
{
  "protocol":      "nexushosting/1.0",
  "name":          "My Node",
  "domain":        "peer.example.com",
  "region":        "ap-southeast-3",
  "publicKey":     "MCowBQYDK2VdAyEAaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef==",
  "joinedAt":      "2026-01-01T00:00:00.000Z",
  "capabilities":  ["site-hosting", "node-federation", "key-verification", "site-replication", "dynamic-hosting", "nlpl"],
  "storageUsedMb": 1240,
  "capacityGb":    50,
  "activeSites":   12,
  "softwareVersion": "1.0.0",
  "operatorEmail": "ops@peer.example.com"
}
```

`capabilities` is an array of feature strings. Conforming implementations must:
- Treat unknown capability strings as a no-op (forward compatibility)
- Only omit `"dynamic-hosting"` / `"nlpl"` when `NEXUS_STATIC_ONLY=true`

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
POST /api/federation/sync
Content-Type: application/json
X-Federation-Signature: <base64url>
X-Federation-From: source-node.example.com

{
  "siteDomain":   "mysite.example.com",
  "deploymentId": 47,
  "timestamp":    "1735689600000"
}
```

**Signature construction:**
```
message   = "{siteDomain}:{deploymentId}:{timestamp}"
          = "mysite.example.com:47:1735689600000"
signature = Ed25519.sign(privateKey, UTF8(message))
header    = base64url(signature)
```

Receiving nodes **MUST**:
1. Check the sender domain is not on the local blocklist.
2. Verify the signature using the sender's public key.
3. Log the event in `federation_events`.

Receiving nodes **SHOULD**:
4. Optionally mirror the deployment if configured as a replica node.

**Sync response (200 OK):**
```json
{ "received": true, "domain": "mysite.example.com", "deploymentId": 47 }
```

### Gossip push wire format

```
POST /api/federation/gossip/push
Content-Type: application/json
X-Federation-Signature: <base64url>

{
  "fromDomain": "source-node.example.com",
  "peers": [
    {
      "domain":    "other-node.example.com",
      "publicKey": "MCowBQYDK2VdAyEA..."
    },
    {
      "domain":    "third-node.example.com",
      "publicKey": "MCowBQYDK2VdAyEA..."
    }
  ],
  "timestamp": 1735689600000
}
```

Signature covers: `JSON.stringify({ fromDomain, peers, timestamp })`.

Blocked nodes are excluded from the `peers` array — they are not propagated to other nodes.

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

### Event wire format

```json
{
  "id":             123,
  "eventType":      "site_sync",
  "fromNodeDomain": "source-node.example.com",
  "toNodeDomain":   "this-node.example.com",
  "payload":        { "siteDomain": "mysite.example.com", "deploymentId": 47 },
  "verified":       1,
  "createdAt":      "2026-01-01T00:00:00.000Z"
}
```

`verified: 1` means the Ed25519 signature on the event was valid. Implementations **MUST** store events regardless of verification result, marking unverified events for operator review.

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
- Future versions of this spec will be versioned as `nexushosting/1.1`, `nexushosting/2.0`, etc. Nodes SHOULD advertise the highest version they support.

---

## Reference Implementation

TypeScript/Node.js: [`artifacts/api-server/src/lib/federation.ts`](artifacts/api-server/src/lib/federation.ts)

Federation routes: [`artifacts/api-server/src/routes/federation.ts`](artifacts/api-server/src/routes/federation.ts)
