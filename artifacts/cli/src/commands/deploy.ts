import { Command } from "commander";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { glob } from "glob";
import mime from "mime-types";
import { apiFetch, apiUpload } from "../api.js";
import { requireAuth } from "../config.js";

interface Site {
  id: number;
  name: string;
  domain: string;
  status: string;
}

interface UploadUrlResponse {
  uploadUrl: string;
  objectPath: string;
  filePath: string;
}

interface DeployResponse {
  id: number;
  version: number;
  fileCount: number;
  totalSizeMb: number;
  replication: { peers: number; synced: number };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function collectFiles(dir: string): Promise<Array<{ abs: string; rel: string }>> {
  const patterns = ["**/*"];
  const files = await glob(patterns, {
    cwd: dir,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", ".DS_Store", "**/.DS_Store"],
    dot: false,
  });
  return files.map((f) => ({ abs: path.resolve(dir, f), rel: f }));
}

export const deployCommand = new Command("deploy")
  .description("Upload a local directory and deploy it as a site")
  .argument("<dir>", "Directory to deploy (must contain index.html)")
  .requiredOption("-s, --site <id>", "Site ID to deploy to")
  .option("--dry-run", "List files that would be uploaded without deploying")
  .option("-c, --concurrency <n>", "Number of parallel uploads", "4")
  .action(async (dir: string, opts: { site: string; dryRun?: boolean; concurrency: string }) => {
    const absDir = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(absDir)) {
      console.error(chalk.red(`Directory not found: ${absDir}`));
      process.exit(1);
    }

    const siteId = parseInt(opts.site, 10);
    if (Number.isNaN(siteId)) {
      console.error(chalk.red("--site must be a numeric site ID"));
      process.exit(1);
    }

    const concurrency = Math.max(1, Math.min(10, parseInt(opts.concurrency, 10)));

    // Collect files
    const collectSpinner = ora("Scanning files").start();
    const files = await collectFiles(absDir);
    collectSpinner.succeed(`Found ${chalk.bold(files.length)} files`);

    if (files.length === 0) {
      console.error(chalk.red("No files found in directory"));
      process.exit(1);
    }

    const indexHtml = files.find((f) => f.rel === "index.html");
    if (!indexHtml) {
      console.warn(chalk.yellow("⚠ No index.html found — site may not serve correctly"));
    }

    const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f.abs).size, 0);
    console.log(chalk.dim(`  Total: ${formatBytes(totalBytes)}\n`));

    if (opts.dryRun) {
      console.log(chalk.cyan("Files that would be uploaded:"));
      for (const f of files) {
        const size = fs.statSync(f.abs).size;
        console.log(`  ${chalk.white(f.rel)} ${chalk.dim(formatBytes(size))}`);
      }
      return;
    }

    // Upload files in parallel with progress bar
    const total      = files.length;
    let uploaded     = 0;
    let failed       = 0;
    let deduplicated = 0;
    let totalBytes   = 0;

    function progressLine() {
      const pct   = total > 0 ? Math.round((uploaded + failed) / total * 100) : 0;
      const bar   = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
      const dedup = deduplicated > 0 ? chalk.dim(` (${deduplicated} deduped)`) : "";
      const mb    = totalBytes > 0 ? chalk.dim(` ${(totalBytes / 1024 / 1024).toFixed(1)} MB`) : "";
      return `  [${chalk.cyan(bar)}] ${pct}% — ${uploaded + failed}/${total} files${mb}${dedup}`;
    }

    process.stdout.write(progressLine());

    async function uploadFile(f: { abs: string; rel: string }): Promise<void> {
      const stat = fs.statSync(f.abs);
      const size = stat.size;
      const contentType = (mime.lookup(f.abs) || "application/octet-stream") as string;

      // Compute SHA-256 hash for server-side deduplication.
      const contentHash = await new Promise<string>((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        fs.createReadStream(f.abs)
          .on("data", (chunk) => hash.update(chunk))
          .on("end",  () => resolve(hash.digest("hex")))
          .on("error", reject);
      });

      // Retry up to 3 times with exponential backoff (1s, 2s, 4s)
      const MAX_RETRIES = 3;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
          await new Promise(r => setTimeout(r, delay));
        }
        try {
          const { uploadUrl, objectPath } = await apiFetch<UploadUrlResponse>(
            `/sites/${siteId}/files/upload-url`,
            { method: "POST", body: JSON.stringify({ filePath: f.rel, contentType, size }) },
          );
          await apiUpload(uploadUrl, fs.createReadStream(f.abs), contentType, size);
          const reg = await apiFetch<{ deduplicated?: boolean }>(`/sites/${siteId}/files`, {
            method: "POST",
            body: JSON.stringify({ filePath: f.rel, objectPath, contentType, sizeBytes: size, contentHash }),
          });
          if (reg.deduplicated) deduplicated++; else totalBytes += size;
          return; // success
        } catch (err) {
          lastError = err as Error;
          if (attempt < MAX_RETRIES) continue;
        }
      }
      throw lastError ?? new Error(`Failed to upload ${f.rel}`);
    }

    // Chunked concurrency
    for (let i = 0; i < files.length; i += concurrency) {
      const chunk = files.slice(i, i + concurrency);
      const results = await Promise.allSettled(chunk.map(uploadFile));
      for (const [j, result] of results.entries()) {
        if (result.status === "fulfilled") {
          uploaded++;
        } else {
          failed++;
          process.stdout.write("\r" + " ".repeat(80) + "\r");
          console.log(chalk.red(`  ✗ ${chunk[j]?.rel}: ${(result.reason as Error).message}`));
        }
      }
      process.stdout.write("\r" + progressLine());
    }

    process.stdout.write("\n");

    if (failed > 0) {
      console.log(chalk.yellow(`  ⚠ Uploaded ${uploaded}/${total} files (${failed} failed)`));
    } else {
      const dd   = deduplicated > 0 ? chalk.dim(` · ${deduplicated} deduplicated`) : "";
      const mbStr = totalBytes > 0 ? chalk.dim(` · ${(totalBytes / 1024 / 1024).toFixed(1)} MB`) : "";
      console.log(chalk.green(`  ✓ Uploaded ${chalk.bold(String(uploaded))} files${mbStr}${dd}`));
    }

    if (uploaded === 0) {
      console.error(chalk.red("All uploads failed — aborting deploy"));
      process.exit(1);
    }

    // Trigger deploy
    const deploySpinner = ora("Deploying…").start();
    try {
      const result = await apiFetch<DeployResponse>(`/sites/${siteId}/deploy`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      deploySpinner.succeed(
        chalk.green(`Deployed! `) +
          chalk.dim(`v${result.version} · ${result.fileCount} files · ${result.totalSizeMb.toFixed(2)} MB`),
      );

      if (result.replication.peers > 0) {
        const synced = result.replication.synced;
        const total = result.replication.peers;
        const icon = synced === total ? "✓" : "⚠";
        console.log(
          `  ${icon} Federation: ${chalk.bold(`${synced}/${total}`)} peers synced`,
        );
      }

      // Fetch site domain for the success message
      try {
        const site = await apiFetch<Site>(`/sites/${siteId}`);
        console.log();
        console.log(chalk.bold("  🌐 Live at: ") + chalk.cyan(`https://${site.domain}`));
      } catch { /* not critical */ }
    } catch (err: any) {
      deploySpinner.fail(chalk.red(`Deploy failed: ${err.message}`));
      process.exit(1);
    }
  });
