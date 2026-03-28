import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as readline from "readline/promises";
import { saveConfig } from "../config.js";
import { apiFetch } from "../api.js";
import fs from "fs";
import path from "path";

interface HealthResponse {
  status: string;
  version: string;
}

interface FederationMeta {
  name: string;
  domain: string;
  region: string;
  nodeCount: number;
}

export const initCommand = new Command("init")
  .description("Interactive first-time setup — connect to a node and create your first site")
  .option("-n, --node <url>", "Node URL to connect to")
  .option("--token <token>", "API token (skip interactive login)")
  .option("--skip-site", "Skip site creation step")
  .action(async (opts: { node?: string; token?: string; skipSite?: boolean }) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    try {
      console.log();
      console.log(chalk.bold("  ⚡ NexusHosting Setup Wizard"));
      console.log(chalk.dim("  Let's get your first site deployed.\n"));

      // ── Step 1: Node URL ─────────────────────────────────────────────────
      let nodeUrl = opts.node;
      if (!nodeUrl) {
        nodeUrl = await rl.question(
          chalk.cyan("  Node URL") + chalk.dim(" (e.g. https://node.example.com): "),
        );
      }
      nodeUrl = nodeUrl.trim().replace(/\/$/, "");
      if (!nodeUrl.startsWith("http")) nodeUrl = `https://${nodeUrl}`;

      const probe = ora(`  Connecting to ${chalk.bold(nodeUrl)}`).start();
      let meta: FederationMeta | null = null;
      try {
        const healthRes = await fetch(`${nodeUrl}/api/health`, { signal: AbortSignal.timeout(8000) });
        if (!healthRes.ok) throw new Error(`HTTP ${healthRes.status}`);
        const health = await healthRes.json() as HealthResponse;

        const metaRes = await fetch(`${nodeUrl}/api/federation/meta`, { signal: AbortSignal.timeout(5000) });
        if (metaRes.ok) meta = await metaRes.json() as FederationMeta;

        probe.succeed(
          chalk.green(`Connected`) +
          chalk.dim(` — ${meta?.name ?? nodeUrl} · v${health.version} · ${meta?.region ?? "unknown region"}`),
        );
      } catch (err: any) {
        probe.fail(chalk.red(`Cannot reach node: ${err.message}`));
        rl.close();
        process.exit(1);
      }

      // ── Step 2: Authentication ──────────────────────────────────────────
      let token = opts.token?.trim();

      if (!token) {
        console.log();
        console.log(chalk.yellow("  Authentication required."));
        console.log(chalk.dim(`  1. Open ${chalk.cyan(nodeUrl)} in your browser and sign in`));
        console.log(chalk.dim("  2. Go to My Sites → API Tokens → New Token"));
        console.log(chalk.dim("  3. Paste the token below (starts with fh_)\n"));

        token = await rl.question(chalk.cyan("  Paste API token: "));
        token = token.trim();
      }

      if (!token.startsWith("nh_")) {
        console.error(chalk.red("\n  Invalid token format — must start with fh_"));
        rl.close();
        process.exit(1);
      }

      const authSpinner = ora("  Verifying token").start();
      try {
        const authRes = await fetch(`${nodeUrl}/api/auth/user`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!authRes.ok) throw new Error(`HTTP ${authRes.status}`);
        const { user } = await authRes.json() as { user: { id: string; email?: string; firstName?: string } | null };
        if (!user) throw new Error("Token valid but no user — make sure you're logged in first");
        authSpinner.succeed(
          chalk.green(`Authenticated`) +
          chalk.dim(` as ${user.firstName ?? user.email ?? user.id}`),
        );
      } catch (err: any) {
        authSpinner.fail(chalk.red(`Auth failed: ${err.message}`));
        rl.close();
        process.exit(1);
      }

      // Save credentials
      saveConfig({ nodeUrl, token, tokenName: "init-wizard" });

      // ── Step 3: Create first site ───────────────────────────────────────
      if (!opts.skipSite) {
        console.log();
        const createSite = await rl.question(chalk.cyan("  Create your first site now?") + chalk.dim(" [Y/n]: "));

        if (!["n", "no"].includes(createSite.trim().toLowerCase())) {
          const siteName   = await rl.question(chalk.cyan("  Site name: "));
          const siteDomain = await rl.question(chalk.cyan("  Domain") + chalk.dim(" (e.g. mysite.example.com): "));

          const createSpinner = ora("  Creating site").start();

          try {
            const authRes = await fetch(`${nodeUrl}/api/auth/user`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const { user } = await authRes.json() as { user: { id: string; email: string; firstName?: string } };

            const siteRes = await fetch(`${nodeUrl}/api/sites`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                name: siteName.trim(),
                domain: siteDomain.trim(),
                siteType: "static",
                ownerName: user.firstName ?? user.email,
                ownerEmail: user.email,
                ownerId: user.id,
              }),
            });

            if (!siteRes.ok) {
              const body = await siteRes.json() as { message?: string };
              throw new Error(body.message ?? `HTTP ${siteRes.status}`);
            }

            const site = await siteRes.json() as { id: number; domain: string };
            createSpinner.succeed(chalk.green(`Site created!`) + chalk.dim(` ID: ${site.id}`));

            console.log();
            console.log(chalk.bold("  🎉 You're all set!\n"));
            console.log(`  ${chalk.dim("Deploy your site:")}`);
            console.log(`  ${chalk.white(`nh deploy ./dist --site ${site.id}`)}\n`);
            console.log(`  ${chalk.dim("Or with the GitHub Actions workflow:")}`);
            console.log(`  ${chalk.dim("  Set FH_NODE_URL, FH_TOKEN, and FH_SITE_ID secrets, then push.")}\n`);
          } catch (err: any) {
            createSpinner.fail(chalk.red(`Site creation failed: ${err.message}`));
          }
        }
      }

      // ── Final summary ────────────────────────────────────────────────────
      console.log();
      console.log(chalk.bold("  Setup complete ✓\n"));
      console.log(`  ${chalk.dim("Node:")}  ${chalk.cyan(nodeUrl)}`);
      if (meta) {
        console.log(`  ${chalk.dim("Network:")} ${meta.nodeCount} node${meta.nodeCount !== 1 ? "s" : ""} in the federation`);
      }
      console.log();
      console.log(`  ${chalk.dim("Run")} ${chalk.white("fh --help")} ${chalk.dim("to see all available commands.")}`);
      console.log();
    } finally {
      rl.close();
    }
  });
