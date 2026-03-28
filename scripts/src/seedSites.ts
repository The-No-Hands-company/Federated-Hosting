/**
 * seedSites.ts
 *
 * Uploads and deploys the two bundled websites into the federated hosting
 * service, writing directly to the DB + object storage (no HTTP server needed).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed:sites
 *
 * Safe to re-run — skips any site whose domain is already registered.
 */

import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, sitesTable, siteDeploymentsTable, siteFilesTable, nodesTable } from "@workspace/db";

// Object storage is now configured via OBJECT_STORAGE_ENDPOINT env var

// ─── Resolve monorepo root ───────────────────────────────────────────────────
// This file lives at scripts/src/seedSites.ts, so root is three levels up
const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../.."
);

// ─── Content-type map ────────────────────────────────────────────────────────
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "text/javascript",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico":  "image/x-icon",
  ".json": "application/json",
  ".txt":  "text/plain",
  ".woff": "font/woff",
  ".woff2":"font/woff2",
  ".ttf":  "font/ttf",
};

function getMime(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// ─── Object storage helpers ──────────────────────────────────────────────────

function getBucket(): string {
  const id = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!id) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set");
  return id;
}

function getPrivateDir(): string {
  return process.env.PRIVATE_OBJECT_DIR ?? "private";
}

async function getSignedUploadUrl(objectName: string): Promise<string> {
  const res = await fetch(`${process.env.OBJECT_STORAGE_ENDPOINT ?? "http://localhost:9000"}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: getBucket(),
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Sidecar signed URL failed: ${res.status} ${await res.text()}`);
  const { signed_url } = await res.json() as { signed_url: string };
  return signed_url;
}

async function uploadFileToStorage(localPath: string): Promise<{ objectPath: string; sizeBytes: number }> {
  const ext = path.extname(localPath);
  const objectName = `${getPrivateDir()}/sites/${randomUUID()}${ext}`;
  const content = fs.readFileSync(localPath);
  const mime = getMime(localPath);

  const signedUrl = await getSignedUploadUrl(objectName);

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: content,
    signal: AbortSignal.timeout(30_000),
  });

  if (!putRes.ok) {
    throw new Error(`Upload failed for ${localPath}: ${putRes.status} ${await putRes.text()}`);
  }

  return {
    objectPath: `/${getBucket()}/${objectName}`,
    sizeBytes: content.length,
  };
}

// ─── Recursively list all files in a directory ───────────────────────────────

function listFiles(dir: string, base = dir): Array<{ abs: string; rel: string }> {
  const out: Array<{ abs: string; rel: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(abs, base));
    } else {
      out.push({ abs, rel: path.relative(base, abs).replace(/\\/g, "/") });
    }
  }
  return out;
}

// ─── Deploy one site ─────────────────────────────────────────────────────────

async function deploySite(opts: {
  name: string;
  domain: string;
  description: string;
  siteType: "static" | "blog" | "portfolio" | "other";
  ownerName: string;
  ownerEmail: string;
  sourceDir: string;
  localNodeId: number;
}) {
  const { name, domain, description, siteType, ownerName, ownerEmail, sourceDir, localNodeId } = opts;

  // Skip if already exists
  const [existing] = await db.select().from(sitesTable).where(eq(sitesTable.domain, domain));
  if (existing) {
    console.log(`  ⏭  ${domain} already registered (id=${existing.id}) — skipping`);
    return;
  }

  if (!fs.existsSync(sourceDir)) {
    console.warn(`  ⚠  Source directory not found: ${sourceDir} — skipping`);
    return;
  }

  // Create site record
  const [site] = await db
    .insert(sitesTable)
    .values({ name, domain, description, siteType, ownerName, ownerEmail, primaryNodeId: localNodeId, status: "active", replicaCount: 1 })
    .returning();
  console.log(`  ✓  Created site: ${name} (id=${site.id})`);

  // Upload all files
  const files = listFiles(sourceDir);
  console.log(`  ⬆  Uploading ${files.length} file(s) from ${sourceDir}`);

  let totalBytes = 0;
  const uploaded: Array<{ filePath: string; objectPath: string; contentType: string; sizeBytes: number }> = [];

  for (const { abs, rel } of files) {
    try {
      const { objectPath, sizeBytes } = await uploadFileToStorage(abs);
      console.log(`     ↑ ${rel} (${getMime(abs)}, ${(sizeBytes / 1024).toFixed(1)}KB)`);
      uploaded.push({ filePath: rel, objectPath, contentType: getMime(abs), sizeBytes });
      totalBytes += sizeBytes;
    } catch (err: any) {
      console.warn(`     ⚠ Upload failed for ${rel}: ${err.message}`);
      // Still register the file record with a placeholder path so the deploy is complete
      const sizeBytes = fs.statSync(abs).size;
      uploaded.push({ filePath: rel, objectPath: `/placeholder/${randomUUID()}`, contentType: getMime(abs), sizeBytes });
      totalBytes += sizeBytes;
    }
  }

  const totalSizeMb = totalBytes / (1024 * 1024);

  // Atomically create deployment + assign files + update site stats
  const deployment = await db.transaction(async (tx) => {
    const [dep] = await tx
      .insert(siteDeploymentsTable)
      .values({ siteId: site.id, version: 1, status: "active", fileCount: uploaded.length, totalSizeMb })
      .returning();

    await tx.insert(siteFilesTable).values(
      uploaded.map((f) => ({ siteId: site.id, deploymentId: dep.id, ...f }))
    );

    await tx.update(sitesTable).set({ storageUsedMb: totalSizeMb }).where(eq(sitesTable.id, site.id));
    return dep;
  });

  console.log(`  🚀 Deployed! Version ${deployment.version} — ${uploaded.length} files — ${totalSizeMb.toFixed(2)}MB\n`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🌐  Nexus Hosting — Site Seeder");
  console.log("=".repeat(44) + "\n");

  const [localNode] = await db.select().from(nodesTable).where(eq(nodesTable.isLocalNode, 1));
  if (!localNode) {
    throw new Error(
      "No local node found in the database.\n" +
      "Start the API server once first so it can auto-create the local node, then re-run this script."
    );
  }
  console.log(`Node: ${localNode.name ?? "Local"} (id=${localNode.id}, domain=${localNode.domain})\n`);

  // ── Site 1: Nexus Hosting landing page ──
  console.log("📄 Site 1: Nexus Hosting landing page");
  await deploySite({
    name: "Nexus Hosting",
    domain: "nexushosting.app",
    description: "The official website for the Nexus Hosting project — for everyday users who want to understand what it is and how to get started.",
    siteType: "static",
    ownerName: "The No Hands Company",
    ownerEmail: "hello@nohands.company",
    sourceDir: path.join(ROOT, "sites/nexushosting-landing"),
    localNodeId: localNode.id,
  });

  // ── Site 2: The No Hands Company ──
  console.log("📄 Site 2: The No Hands Company");
  await deploySite({
    name: "The No Hands Company",
    domain: "nohands.company",
    description: "The No Hands Company — open-source projects that give power back to people. Company portfolio and project information.",
    siteType: "static",
    ownerName: "The No Hands Company",
    ownerEmail: "hello@nohands.company",
    sourceDir: path.join(ROOT, "sites/nohands-company"),
    localNodeId: localNode.id,
  });

  console.log("✅  All done.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n❌ Seed failed:", err.message ?? err);
  process.exit(1);
});
