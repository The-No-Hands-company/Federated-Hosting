import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { requireAuth } from "../config.js";
import { apiFetch, apiUpload } from "../api.js";

interface UploadUrlResponse { uploadUrl: string; objectPath: string; }

let debounceTimer: NodeJS.Timeout | null = null;

function hashFile(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkDir(dir: string, base = dir): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    if (entry.isDirectory()) results.push(...walkDir(full, base));
    else results.push(path.relative(base, full));
  }
  return results;
}

export const watchCommand = new Command("watch")
  .description("Watch a directory and auto-deploy on changes")
  .argument("<dir>", "Directory to watch and deploy")
  .option("--site <id>", "Site ID to deploy to")
  .option("--delay <ms>", "Debounce delay in milliseconds", "800")
  .addHelpText("after", `
Examples:
  nh watch ./dist --site 42
  nh watch ./out  --site 42 --delay 1000

Note: Requires your build tool to output to the watched directory.
For Vite: vite build --watch
For Next.js: next dev (serves from memory, not a good fit for watch mode)
`)
  .action(async (dir: string, opts: { site?: string; delay?: string }) => {
    const cfg = requireAuth();

    if (!opts.site) {
      console.error(chalk.red("  Error: --site <id> is required"));
      process.exit(1);
    }

    const siteId  = parseInt(opts.site, 10);
    const delay   = parseInt(opts.delay ?? "800", 10);
    const absDir  = path.resolve(dir);

    if (!fs.existsSync(absDir)) {
      console.error(chalk.red(`  Directory not found: ${absDir}`));
      process.exit(1);
    }

    console.log();
    console.log(chalk.bold("  NexusHosting Watch Mode"));
    console.log(`  ${chalk.dim("Site:")}  ${chalk.cyan(opts.site)}`);
    console.log(`  ${chalk.dim("Dir:")}   ${chalk.cyan(absDir)}`);
    console.log(`  ${chalk.dim("Delay:")} ${delay}ms`);
    console.log();
    console.log(chalk.dim("  Watching for changes. Press Ctrl+C to stop.\n"));

    // Track file hashes to detect real changes (not just touch events)
    const knownHashes = new Map<string, string>();

    // Initial hash snapshot
    for (const rel of walkDir(absDir)) {
      try { knownHashes.set(rel, hashFile(path.join(absDir, rel))); } catch { /* ignore */ }
    }

    async function deployChanged() {
      const files = walkDir(absDir);
      const changed: string[] = [];

      for (const rel of files) {
        try {
          const hash = hashFile(path.join(absDir, rel));
          if (knownHashes.get(rel) !== hash) {
            changed.push(rel);
            knownHashes.set(rel, hash);
          }
        } catch { /* file may have been deleted mid-walk */ }
      }

      if (changed.length === 0) return;

      const spinner = ora(`  Deploying ${changed.length} changed file${changed.length !== 1 ? "s" : ""}…`).start();

      let uploaded = 0;
      for (const rel of changed) {
        const abs = path.join(absDir, rel);
        if (!fs.existsSync(abs)) continue;

        try {
          const stat = fs.statSync(abs);
          const mime = (await import("mime-types")).default;
          const ct   = (mime.lookup(rel) || "application/octet-stream") as string;
          const hash = knownHashes.get(rel)!;

          const { uploadUrl, objectPath } = await apiFetch<UploadUrlResponse>(
            `/sites/${siteId}/files/upload-url`,
            { method: "POST", body: JSON.stringify({ filePath: rel, contentType: ct, size: stat.size }) }
          );

          await apiUpload(uploadUrl, fs.createReadStream(abs), ct, stat.size);
          await apiFetch(`/sites/${siteId}/files`, {
            method: "POST",
            body: JSON.stringify({ filePath: rel, objectPath, contentType: ct, sizeBytes: stat.size, contentHash: hash }),
          });
          uploaded++;
        } catch { /* continue with other files */ }
      }

      if (uploaded === 0) { spinner.fail("No files uploaded"); return; }

      await apiFetch(`/sites/${siteId}/deploy`, { method: "POST", body: JSON.stringify({ environment: "staging" }) });
      spinner.succeed(chalk.green(`  Deployed ${uploaded} file${uploaded !== 1 ? "s" : ""} `) + chalk.dim(new Date().toLocaleTimeString()));
    }

    fs.watch(absDir, { recursive: true }, (_event, filename) => {
      if (!filename || filename.startsWith(".")) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        deployChanged().catch(err => console.error(chalk.red(`  Deploy error: ${err.message}`)));
      }, delay);
    });

    // Keep alive
    process.on("SIGINT", () => {
      console.log(chalk.dim("\n  Stopped watching."));
      process.exit(0);
    });
    await new Promise(() => {}); // block forever
  });
