import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { requireAuth } from "../config.js";
import { apiFetch } from "../api.js";

interface BuildJob {
  buildId: number;
  status: string;
  message: string;
  log?: string;
}

export const buildCommand = new Command("build")
  .description("Trigger a build from a Git repository")
  .argument("<site-id>", "Site ID to build and deploy to")
  .option("--git-url <url>",         "Git repository URL")
  .option("--branch <branch>",       "Branch to build", "main")
  .option("--command <cmd>",         "Build command", "npm run build")
  .option("--output <dir>",          "Output directory", "dist")
  .option("--env <KEY=VALUE...>",    "Environment variables to inject (repeatable)")
  .option("--install <cmd>",         "Override install command")
  .option("--staging",               "Deploy to staging environment")
  .option("--wait",                  "Wait for build to complete and stream logs")
  .action(async (siteId: string, opts: {
    gitUrl?: string;
    branch?: string;
    command?: string;
    output?: string;
    env?: string[];
    install?: string;
    staging?: boolean;
    wait?: boolean;
  }) => {
    const cfg = requireAuth();

    // Parse KEY=VALUE env vars
    const envVars: Record<string, string> = {};
    for (const pair of opts.env ?? []) {
      const [key, ...rest] = pair.split("=");
      if (key) envVars[key] = rest.join("=");
    }

    const body: Record<string, unknown> = {
      gitBranch:    opts.branch,
      buildCommand: opts.command,
      outputDir:    opts.output,
      environment:  opts.staging ? "staging" : "production",
      ...(opts.gitUrl    ? { gitUrl: opts.gitUrl } : {}),
      ...(opts.install   ? { installCommand: opts.install } : {}),
      ...(Object.keys(envVars).length ? { envVars } : {}),
    };

    const spinner = ora("  Queueing build…").start();

    const job = await apiFetch<BuildJob>(cfg, `/sites/${siteId}/builds`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    spinner.succeed(chalk.green(`  Build #${job.buildId} queued`));

    if (opts.env?.length) {
      console.log(chalk.dim(`  Env vars injected: ${Object.keys(envVars).join(", ")}`));
    }

    console.log(chalk.dim(`  Environment: ${opts.staging ? "staging" : "production"}`));
    console.log();

    if (opts.wait) {
      // Stream logs until build completes
      console.log(chalk.dim("  Waiting for build to complete…\n"));
      let last = 0;
      while (true) {
        await new Promise(r => setTimeout(r, 3000));
        const updated = await apiFetch<{ status: string; log?: string }>(
          cfg, `/sites/${siteId}/builds/${job.buildId}`
        );
        const log = updated.log ?? "";
        if (log.length > last) {
          process.stdout.write(log.slice(last));
          last = log.length;
        }
        if (updated.status === "success") {
          console.log("\n" + chalk.green("  ✓ Build succeeded."));
          break;
        }
        if (["failed", "cancelled"].includes(updated.status)) {
          console.log("\n" + chalk.red(`  ✗ Build ${updated.status}.`));
          process.exit(1);
        }
      }
    } else {
      console.log(chalk.dim(`  Stream logs with: ${chalk.white(`nh logs ${siteId} --build ${job.buildId} --follow`)}`));
      console.log();
    }
  });
