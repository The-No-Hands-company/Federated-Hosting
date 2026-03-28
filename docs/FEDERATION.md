# Nexus Hosting Protocol Specification

**Version:** 1.0  
**Status:** Stable  
**Reference implementation:** [The No Hands Company / Federated-Hosting](https://github.com/The-No-Hands-company/Nexus-Hosting)

This document specifies the federation protocol for nodes in the Nexus Hosting network. Any server that correctly implements this specification can join the network.

---

## Overview

The federation protocol enables independent hosting nodes to:
1. Discover each other through gossip and bootstrap registries
2. Authenticate via Ed25519 signatures
3. Replicate static site deployments across the network
4. Resolve conflicts when the same domain is claimed by multiple nodes

All communication is over HTTPS. Nodes must have valid TLS certificates.

---

## Node Identity

Every node has a unique **Ed25519 key pair** generated at first boot.

- The **public key** is published in the node's discovery document
- The **private key** never leaves the node
- Key format: PEM-encoded SPKI (public) and PKCS#8 (private)

### Discovery document

Every node MUST serve a discovery document at:

```
GET /.well-known/federation
```

Response (JSON):

```json
{
  "name": "My Node",
  "domain": "node.example.com",
  "region": "ap-southeast-3",
  "operatorName": "Alice",
  "operatorEmail": "alice@example.com",
  "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "protocolVersion": "1.0",
  "capabilities": ["site-hosting", "federation-sync", "gossip"],
  "storageCapacityGb": 100,
  "bandwidthCapacityGb": 1000,
  "siteCount": 42,
  "nodeVersion": "0.8.0",
  "joinedAt": "2024-01-01T00:00:00Z"
}
```

All fields are optional except `domain` and `publicKey`.

---

## Handshake

Before two nodes can exchange signed messages, they must complete a handshake. This registers each node in the other's peer database.

### Initiate handshake

```
POST /api/federation/handshake
Authorization: Bearer <token>  (optional — for node-to-node auth)

{
  "targetNodeUrl": "https://target-node.example.com"
}
```

The initiating node:
1. Fetches `/.well-known/federation` from the target
2. Creates a challenge: `<nodeDomain>:<random_hex>:<timestamp_ms>`
3. Signs the challenge with its private key
4. POSTs to the target's `/api/federation/ping`

### Ping (challenge-response)

```
POST /api/federation/ping

{
  "nodeDomain": "initiating-node.example.com",
  "challenge": "<64-char hex string>",
  "signature": "<base64-encoded Ed25519 signature>",
  "timestamp": "<unix timestamp in milliseconds>"
}
```

Receiving node MUST:
- Reject messages where `|timestamp - now| > 300_000` (5 minutes) — replay attack prevention
- Look up the initiating node's public key from its discovery document
- Verify `signature` over `"${nodeDomain}:${challenge}:${timestamp}"` using Ed25519
- Register the initiating node as a peer if verification succeeds

Response:

```json
{
  "status": "ok",
  "node": { "name": "...", "domain": "...", "publicKey": "..." }
}
```

---

## Gossip

Nodes periodically share their peer lists with all known active peers. This is how new nodes propagate through the network without central coordination.

### Push peers

Every **5 minutes**, each node broadcasts its known peer list:

```
POST /api/federation/gossip/push

{
  "fromDomain": "sender.example.com",
  "timestamp": 1704067200000,
  "peers": [
    { "domain": "peer1.example.com", "publicKey": "<base64>" },
    { "domain": "peer2.example.com", "publicKey": "<base64>" }
  ]
}
```

The request body MUST be signed with the sending node's private key:
```
X-Federation-Signature: <base64 Ed25519 signature of JSON body>
```

Receiving node MUST:
- Verify the signature
- For each peer, check if it's already known
- For new peers: fetch their discovery document and register them

### Bootstrap registry

New nodes can join by fetching a bootstrap peer list:

```
GET /api/federation/bootstrap
```

Response:

```json
{
  "protocol": "nexushosting/1.0",
  "nodeCount": 42,
  "generatedAt": "2024-01-01T12:00:00Z",
  "nodes": [
    {
      "domain": "bootstrap.example.com",
      "name": "Bootstrap Node",
      "region": "us-east-1",
      "publicKey": "...",
      "verifiedAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## Site Replication

When a site is deployed, the origin node notifies all peers. Peers can then pull the site's files.

### Sync notification

After a successful deployment, the origin node sends:

```
POST /api/federation/sync
Content-Type: application/json
X-Federation-Signature: <base64 Ed25519 signature of JSON body>
X-Federation-From: origin-node.example.com

{
  "siteDomain": "mysite.example.com",
  "deploymentId": 42,
  "timestamp": "1704067200000",
  "fromDomain": "origin-node.example.com"
}
```

### File manifest

The receiving node fetches the file list and download URLs:

```
GET /api/federation/manifest/:siteDomain?deploymentId=42
```

Response:

```json
{
  "siteDomain": "mysite.example.com",
  "deploymentId": 42,
  "origin": "origin-node.example.com",
  "generatedAt": "2024-01-01T12:00:00Z",
  "expiresAt": "2024-01-01T13:00:00Z",
  "files": [
    {
      "filePath": "index.html",
      "contentType": "text/html",
      "sizeBytes": 1024,
      "downloadUrl": "https://storage.example.com/presigned-url"
    }
  ]
}
```

Download URLs are presigned and valid for **1 hour**. After downloading all files, the receiving node creates a local deployment marked as a replica.

### Conflict resolution

When two nodes claim the same domain, the following algorithm determines which version takes precedence:

1. **Same-origin update** — if the sync comes from the node that originally created the site, always accept
2. **Invalid signature** — reject immediately
3. **Earlier `joinedAt` wins** — the node that joined the network first owns the domain (first-write-wins)
4. **Equal timestamps** — lexicographically smaller Ed25519 public key wins (deterministic tiebreaker)

Conflict rejection response:

```json
{
  "status": "conflict",
  "winner": "local",
  "reason": "local_node_older",
  "message": "This node's version of 'site.example.com' takes precedence (local_node_older)."
}
```

---

## Message Signing

All signed messages use **Ed25519** via the standard Node.js `crypto` module:

```javascript
// Sign
const signature = crypto
  .sign(null, Buffer.from(message), privateKey)
  .toString("base64");

// Verify
const valid = crypto.verify(
  null,
  Buffer.from(message),
  publicKey,
  Buffer.from(signature, "base64")
);
```

Where:
- `privateKey` is a `crypto.KeyObject` created from the PEM private key
- `publicKey` is a `crypto.KeyObject` created from the PEM public key
- `message` is a UTF-8 string

Signatures are sent as base64-encoded bytes in the `X-Federation-Signature` header or in the JSON body as `signature`.

---

## Error codes

| HTTP | `error.code` | Meaning |
|---|---|---|
| 409 | `CONFLICT` | Domain conflict — local node wins |
| 400 | `STALE_MESSAGE` | Timestamp older than 5 minutes |
| 400 | `INVALID_SIGNATURE` | Ed25519 verification failed |
| 404 | `SITE_NOT_FOUND` | Site not found for federation manifest |
| 202 | — | Sync queued (manifest temporarily unavailable) |

---

## Implementation notes

- All peer operations use `Promise.allSettled` — a dead peer never fails a user-facing request
- Failed syncs are retried with exponential backoff (30s → 2m → 10m → 1h → 6h, max 10 attempts)
- The gossip peer list is stored in the `nodes` database table — it persists across restarts
- Nodes that fail health checks 3 consecutive times are marked `inactive` and excluded from sync targets
- The `X-Federation-From` header identifies the sending node on sync requests

---

## Versioning

The protocol version is advertised in `/.well-known/federation` as `protocolVersion`. The current version is `1.0`. Future breaking changes will increment the major version. Nodes SHOULD accept messages from nodes running the same major version.
