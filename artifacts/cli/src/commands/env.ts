import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { requireAuth } from "../config.js";
import { apiFetch } from "../api.js";

interface EnvVar { id: number; key: string; value: string; secret: number; createdAt: string; }

export const envCommand = new Command("env")
  .description("Manage environment variables for site builds")
  .addCommand(
    new Command("list")
      .description("List env vars for a site")
      .argument("<site-id>", "Site ID")
      .option("--show-secrets", "Reveal secret values")
      .action(async (siteId: string, opts: { showSecrets?: boolean }) => {
        const cfg = requireAuth();
        const spinner = ora("  Fetching env vars…").start();
        const vars = await apiFetch<EnvVar[]>(cfg, `/sites/${siteId}/env`);
        spinner.stop();
        if (vars.length === 0) { console.log(chalk.dim("  No env vars set. Add with: nh env set <site-id> KEY value")); return; }
        console.log();
        for (const v of vars) {
          const display = v.secret && !opts.showSecrets ? chalk.dim("***hidden***") : chalk.cyan(v.value);
          console.log(`  ${chalk.bold(v.key.padEnd(30))} ${display}${v.secret ? chalk.dim(" (secret)") : ""}`);
        }
        console.log();
      })
  )
  .addCommand(
    new Command("set")
      .description("Set an environment variable")
      .argument("<site-id>", "Site ID")
      .argument("<key>", "Variable name (e.g. VITE_API_URL)")
      .argument("<value>", "Variable value")
      .option("--secret", "Mark as secret (value masked in list output)")
      .action(async (siteId: string, key: string, value: string, opts: { secret?: boolean }) => {
        const cfg = requireAuth();
        const spinner = ora(`  Setting ${key}…`).start();
        await apiFetch(cfg, `/sites/${siteId}/env`, {
          method: "POST",
          body: JSON.stringify({ key, value, secret: opts.secret ? 1 : 0 }),
        });
        spinner.succeed(chalk.green(`  Set ${chalk.bold(key)}`));
      })
  )
  .addCommand(
    new Command("unset")
      .description("Remove an environment variable")
      .argument("<site-id>", "Site ID")
      .argument("<key>", "Variable name to remove")
      .action(async (siteId: string, key: string) => {
        const cfg = requireAuth();
        const spinner = ora(`  Removing ${key}…`).start();
        await apiFetch(cfg, `/sites/${siteId}/env/${encodeURIComponent(key)}`, { method: "DELETE" });
        spinner.succeed(chalk.green(`  Removed ${chalk.bold(key)}`));
      })
  )
  .addCommand(
    new Command("pull")
      .description("Print env vars as export statements (for sourcing locally)")
      .argument("<site-id>", "Site ID")
      .action(async (siteId: string) => {
        const cfg = requireAuth();
        const vars = await apiFetch<EnvVar[]>(cfg, `/sites/${siteId}/env?showSecrets=true`);
        for (const v of vars) {
          if (!v.secret) console.log(`export ${v.key}=${JSON.stringify(v.value)}`);
        }
      })
  );
