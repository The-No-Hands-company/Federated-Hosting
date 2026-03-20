import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiFetch } from "../api.js";

interface Deployment {
  id: number;
  version: number;
  status: string;
  fileCount: number;
  totalSizeMb: number;
  deployedAt: string;
  deployedBy: string | null;
}

interface RollbackResult {
  id: number;
  version: number;
  status: string;
  rolledBackFrom: number;
}

function statusColor(status: string): string {
  switch (status) {
    case "active":      return chalk.green(status);
    case "rolled_back": return chalk.dim(status.replace("_", " "));
    case "failed":      return chalk.red(status);
    default:            return chalk.yellow(status);
  }
}

export const rollbackCommand = new Command("rollback")
  .description("Roll back a site to a previous deployment version")
  .requiredOption("-s, --site <id>", "Site ID")
  .option("-v, --version <version>", "Target version number (omit to pick interactively)")
  .option("--list", "List available deployments and exit")
  .action(async (opts: { site: string; version?: string; list?: boolean }) => {
    const siteId = parseInt(opts.site, 10);
    if (Number.isNaN(siteId)) {
      console.error(chalk.red("--site must be a numeric site ID"));
      process.exit(1);
    }

    // Fetch deployment history
    const listSpinner = ora("Fetching deployment history").start();
    let deployments: Deployment[];
    try {
      deployments = await apiFetch<Deployment[]>(`/sites/${siteId}/deployments`);
      listSpinner.stop();
    } catch (err: any) {
      listSpinner.fail(chalk.red(err.message));
      process.exit(1);
    }

    if (deployments.length === 0) {
      console.log(chalk.dim("No deployments found for this site."));
      return;
    }

    // Sort newest first
    const sorted = [...deployments].sort((a, b) => b.version - a.version);

    // Print table
    console.log();
    console.log(
      chalk.bold(
        `  ${"Ver".padEnd(6)} ${"Status".padEnd(14)} ${"Files".padEnd(8)} ${"Size".padEnd(10)} Deployed`,
      ),
    );
    console.log(chalk.dim("  " + "─".repeat(60)));

    for (const d of sorted) {
      const isActive = d.status === "active";
      const marker = isActive ? chalk.green("▶") : " ";
      const deployedBy = d.deployedBy?.startsWith("federation:")
        ? chalk.dim("(replicated)")
        : new Date(d.deployedAt).toLocaleString();

      console.log(
        `  ${marker} v${String(d.version).padEnd(4)} ` +
          `${statusColor(d.status).padEnd(14)} ` +
          `${String(d.fileCount).padEnd(8)} ` +
          `${(d.totalSizeMb.toFixed(2) + " MB").padEnd(10)} ` +
          `${deployedBy}`,
      );
    }
    console.log();

    if (opts.list) return;

    // Determine target deployment
    let targetDep: Deployment | undefined;

    if (opts.version) {
      const targetVersion = parseInt(opts.version, 10);
      targetDep = sorted.find((d) => d.version === targetVersion);
      if (!targetDep) {
        console.error(chalk.red(`Version v${targetVersion} not found`));
        process.exit(1);
      }
    } else {
      // Default: roll back to the most recent non-active deployment
      targetDep = sorted.find((d) => d.status !== "active" && d.status !== "failed" && d.fileCount > 0);
      if (!targetDep) {
        console.log(chalk.dim("No previous deployments available to roll back to."));
        return;
      }
      console.log(
        chalk.cyan(`Targeting v${targetDep.version}`) +
          chalk.dim(` (use --version to specify a different one)`),
      );
    }

    const active = sorted.find((d) => d.status === "active");
    if (active) {
      console.log(
        chalk.yellow(`⚠  This will replace v${active.version} (active) with v${targetDep.version}`),
      );
    }

    // Confirm
    const { createInterface } = await import("readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(chalk.cyan("Confirm rollback? [y/N] "));
    rl.close();

    if (!["y", "yes"].includes(answer.trim().toLowerCase())) {
      console.log(chalk.dim("Rollback cancelled."));
      return;
    }

    // Execute
    const rollbackSpinner = ora(`Rolling back to v${targetDep.version}…`).start();
    try {
      const result = await apiFetch<RollbackResult>(
        `/sites/${siteId}/deployments/${targetDep.id}/rollback`,
        { method: "POST" },
      );
      rollbackSpinner.succeed(
        chalk.green(`Rolled back! `) +
          chalk.dim(`v${result.version} is now active (was v${active?.version ?? "?"}, rolled back from v${result.rolledBackFrom})`),
      );
    } catch (err: any) {
      rollbackSpinner.fail(chalk.red(`Rollback failed: ${err.message}`));
      process.exit(1);
    }
  });
