import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as readline from "readline/promises";
import { saveConfig, clearConfig, getConfig } from "../config.js";
import { apiFetch } from "../api.js";

interface TokenCreateResponse {
  id: number;
  name: string;
  token: string;
  tokenPrefix: string;
  createdAt: string;
}

export const loginCommand = new Command("login")
  .description("Authenticate to a NexusHosting node and store credentials")
  .option("-n, --node <url>", "Node URL (e.g. https://mynode.example.com)")
  .option("-t, --token <token>", "Existing API token (skip interactive flow)")
  .action(async (opts: { node?: string; token?: string }) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      // --- Resolve node URL ---
      let nodeUrl = opts.node ?? getConfig().nodeUrl;
      if (!nodeUrl) {
        nodeUrl = await rl.question(
          chalk.cyan("Node URL") + chalk.dim(" (e.g. https://mynode.example.com): "),
        );
      }
      nodeUrl = nodeUrl.replace(/\/$/, "");

      // --- Verify node is reachable ---
      const probe = ora(`Connecting to ${chalk.bold(nodeUrl)}`).start();
      try {
        const health = await apiFetch<{ status: string }>("/health", {
          auth: false,
          headers: { "x-node-url": nodeUrl } as Record<string, string>,
        });
        // Manually override because requireAuth isn't set yet
        const healthRes = await fetch(`${nodeUrl}/api/health`);
        if (!healthRes.ok) throw new Error(`Node returned ${healthRes.status}`);
        probe.succeed(chalk.green("Node reachable"));
      } catch (err: any) {
        probe.fail(chalk.red(`Cannot reach node: ${err.message}`));
        process.exit(1);
      }

      // --- Use provided token or create new one ---
      let token: string;
      let tokenName: string;

      if (opts.token) {
        token = opts.token;
        tokenName = "provided";
      } else {
        // User must have a session token (from browser login) to create an API token.
        // We tell them to visit /api/login first and paste their Bearer token, OR
        // we guide them through the create-token flow.
        console.log();
        console.log(chalk.yellow("You need an API token. To create one:"));
        console.log(
          chalk.dim("  1. Open ") +
            chalk.cyan(`${nodeUrl}`) +
            chalk.dim(" in your browser and sign in"),
        );
        console.log(
          chalk.dim("  2. Go to ") +
            chalk.bold("My Sites → API Tokens") +
            chalk.dim(" and create a token named 'cli'"),
        );
        console.log(chalk.dim("  3. Paste it below\n"));

        token = await rl.question(chalk.cyan("Paste your API token: "));
        token = token.trim();
        if (!token.startsWith("nh_")) {
          console.error(chalk.red("Invalid token format (should start with fh_)"));
          process.exit(1);
        }
        tokenName = "cli";
      }

      // --- Verify token works ---
      const verify = ora("Verifying token").start();
      try {
        const resp = await fetch(`${nodeUrl}/api/auth/user`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error(`Status ${resp.status}`);
        const { user } = await resp.json() as { user: { email?: string; firstName?: string } | null };
        if (!user) throw new Error("Token is valid but no user returned — make sure you're authenticated first");
        verify.succeed(
          chalk.green(`Authenticated as `) +
            chalk.bold(user.firstName ?? user.email ?? "unknown"),
        );
      } catch (err: any) {
        verify.fail(chalk.red(`Token verification failed: ${err.message}`));
        process.exit(1);
      }

      // --- Persist ---
      saveConfig({ nodeUrl, token, tokenName });

      console.log();
      console.log(chalk.green("✓ Logged in!"));
      console.log(chalk.dim(`  Config saved to local store`));
      console.log(chalk.dim(`  Run ${chalk.white("nh deploy <dir> --site <id>")} to deploy a site`));
    } finally {
      rl.close();
    }
  });

export const logoutCommand = new Command("logout")
  .description("Remove stored credentials")
  .action(() => {
    clearConfig();
    console.log(chalk.green("✓ Logged out — credentials removed"));
  });
