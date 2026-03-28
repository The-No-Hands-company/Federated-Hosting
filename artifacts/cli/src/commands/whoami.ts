import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { getConfig } from "../config.js";
import { apiFetch } from "../api.js";

interface AuthUser {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  isAdmin?: number;
}

export const whoamiCommand = new Command("whoami")
  .description("Show the currently authenticated user and node")
  .option("--json", "Output as JSON")
  .action(async (opts: { json?: boolean }) => {
    const cfg = getConfig();

    if (!cfg.nodeUrl || !cfg.token) {
      if (opts.json) {
        console.log(JSON.stringify({ authenticated: false }));
      } else {
        console.log(chalk.yellow("  Not logged in.") + chalk.dim("  Run: nh login --node <url>"));
      }
      process.exit(1);
    }

    const spinner = opts.json ? null : ora("  Checking authentication…").start();

    try {
      const res = await apiFetch(cfg, "/auth/user");
      const { user } = await res.json() as { user: AuthUser | null };

      if (!user) {
        spinner?.fail(chalk.red("  Token is invalid or expired."));
        console.log(chalk.dim("  Run: nh logout && nh login --node " + cfg.nodeUrl));
        process.exit(1);
      }

      spinner?.stop();

      if (opts.json) {
        console.log(JSON.stringify({ authenticated: true, user, nodeUrl: cfg.nodeUrl, tokenName: cfg.tokenName }, null, 2));
        return;
      }

      console.log();
      console.log(chalk.bold("  Current session\n"));
      console.log(`  ${chalk.dim("Node:")}    ${chalk.cyan(cfg.nodeUrl)}`);
      console.log(`  ${chalk.dim("Token:")}   ${cfg.tokenName ?? "unnamed"}`);
      console.log(`  ${chalk.dim("User:")}    ${user.firstName ? `${user.firstName} ${user.lastName ?? ""}`.trim() : chalk.dim("(no name)")}`);
      console.log(`  ${chalk.dim("Email:")}   ${user.email ?? chalk.dim("(no email)")}`);
      console.log(`  ${chalk.dim("ID:")}      ${chalk.dim(user.id)}`);
      if (user.isAdmin) console.log(`  ${chalk.dim("Role:")}    ${chalk.yellow("operator / admin")}`);
      console.log();
    } catch (err: any) {
      spinner?.fail(chalk.red(`  Auth check failed: ${err.message}`));
      process.exit(1);
    }
  });
