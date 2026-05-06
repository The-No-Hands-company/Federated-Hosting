import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import logger from "./logger";
import { fetchCloudDomainTable, fetchCloudExposureTable, fetchCloudRouteTable, fetchCloudTrustSummary } from "./nexusCloudClient";

export type CloudRouteSyncOptions = {
  cloudBaseUrl: string;
  apiKey: string;
  outputPath: string;
  intervalMs: number;
};

async function persistRoutes(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

export function startCloudRouteSync(options: CloudRouteSyncOptions): () => void {
  const intervalMs = Math.max(10_000, options.intervalMs);

  const syncOnce = async () => {
    try {
      const [routes, exposures, domains, trust] = await Promise.all([
        fetchCloudRouteTable(options.cloudBaseUrl, options.apiKey),
        fetchCloudExposureTable(options.cloudBaseUrl, options.apiKey),
        fetchCloudDomainTable(options.cloudBaseUrl, options.apiKey),
        fetchCloudTrustSummary(options.cloudBaseUrl, options.apiKey),
      ]);

      await persistRoutes(options.outputPath, {
        syncedAt: new Date().toISOString(),
        routes,
        exposures,
        domains,
        trust,
        summary: {
          routeCount: routes.length,
          exposureCount: exposures.length,
          domainCount: domains.length,
          trustedPeerCount: trust.peers.trusted,
          peerCount: trust.peers.total,
        },
      });

      logger.info(
        {
          routeCount: routes.length,
          exposureCount: exposures.length,
          domainCount: domains.length,
          peerCount: trust.peers.total,
          path: options.outputPath,
        },
        "[cloud-routes] Synced route/exposure/domain/trust state from Nexus Cloud",
      );
    } catch (error) {
      logger.warn({ err: (error as Error).message }, "[cloud-routes] Route sync failed");
    }
  };

  syncOnce().catch(() => {});
  const timer = setInterval(() => {
    syncOnce().catch(() => {});
  }, intervalMs);

  return () => clearInterval(timer);
}
