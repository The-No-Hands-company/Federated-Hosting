import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiFetch } from "../api.js";

interface Site {
  id: number;
  name: string;
  domain: string;
  status: string;
  visibility: string;
  hitCount: number;
  storageUsedMb: number;
  createdAt: string;
}

interface PaginatedSites {
  data: Site[];
  meta: { total: number; page: number; limit: number };
}

function statusColor(status: string): string {
  switch (status) {
    case "active":    return chalk.green(status);
    case "suspended": return chalk.red(status);
    default:          return chalk.yellow(status);
  }
}

export const sitesCommand = new Command("sites")
  .description("Manage your sites");

sitesCommand
  .command("list")
  .description("List your sites")
  .option("--all", "Show all sites (not just yours)")
  .action(async (opts: { all?: boolean }) => {
    const spinner = ora("Fetching sites").start();
    try {
      // Get current user to filter by ownerId
      let ownerId: string | undefined;
      if (!opts.all) {
        const { user } = await apiFetch<{ user: { id: string } | null }>("/auth/user");
        ownerId = user?.id;
      }

      const qp = ownerId ? `?ownerId=${ownerId}&limit=100` : "?limit=100";
      const result = await apiFetch<PaginatedSites>(`/sites${qp}`);
      spinner.stop();

      if (result.data.length === 0) {
        console.log(chalk.dim("No sites found."));
        return;
      }

      console.log();
      console.log(
        chalk.bold(
          `  ${"ID".padEnd(6)} ${"Name".padEnd(28)} ${"Domain".padEnd(32)} ${"Status".padEnd(12)} ${"Hits".padEnd(10)} Storage`,
        ),
      );
      console.log(chalk.dim("  " + "─".repeat(100)));

      for (const s of result.data) {
        const vis = s.visibility !== "public" ? chalk.dim(` [${s.visibility}]`) : "";
        console.log(
          `  ${String(s.id).padEnd(6)} ` +
            `${s.name.slice(0, 27).padEnd(28)} ` +
            `${chalk.cyan(s.domain.slice(0, 31).padEnd(32))} ` +
            `${statusColor(s.status).padEnd(12)} ` +
            `${String(s.hitCount ?? 0).padEnd(10)} ` +
            `${s.storageUsedMb?.toFixed(1)}MB${vis}`,
        );
      }
      console.log();
      console.log(chalk.dim(`  ${result.data.length} of ${result.meta.total} site(s)`));
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

sitesCommand
  .command("create")
  .description("Register a new site")
  .requiredOption("-n, --name <name>", "Site name")
  .requiredOption("-d, --domain <domain>", "Site domain (e.g. mysite.example.com)")
  .option("--type <type>", "Site type: static|blog|portfolio|other", "static")
  .action(async (opts: { name: string; domain: string; type: string }) => {
    const spinner = ora("Creating site").start();
    try {
      const { user } = await apiFetch<{ user: { id: string; email: string; firstName?: string } | null }>("/auth/user");
      if (!user) {
        spinner.fail("Not authenticated");
        process.exit(1);
      }

      const site = await apiFetch<Site>("/sites", {
        method: "POST",
        body: JSON.stringify({
          name: opts.name,
          domain: opts.domain,
          siteType: opts.type,
          ownerName: user.firstName ?? user.email,
          ownerEmail: user.email,
          ownerId: user.id,
        }),
      });

      spinner.succeed(chalk.green(`Site created!`));
      console.log();
      console.log(`  ${chalk.bold("ID:")}     ${site.id}`);
      console.log(`  ${chalk.bold("Name:")}   ${site.name}`);
      console.log(`  ${chalk.bold("Domain:")} ${chalk.cyan(site.domain)}`);
      console.log();
      console.log(
        chalk.dim(`  Deploy with: `) + chalk.white(`nh deploy ./dist --site ${site.id}`),
      );
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

sitesCommand
  .command("info <id>")
  .description("Show details for a site")
  .action(async (id: string) => {
    const spinner = ora("Fetching site").start();
    try {
      const site = await apiFetch<Site & { description?: string }>(`/sites/${id}`);
      spinner.stop();

      console.log();
      console.log(chalk.bold(`  ${site.name}`));
      console.log(chalk.dim(`  ${site.domain}`));
      console.log();
      console.log(`  ${chalk.dim("ID:")}         ${site.id}`);
      console.log(`  ${chalk.dim("Status:")}     ${statusColor(site.status)}`);
      console.log(`  ${chalk.dim("Visibility:")} ${site.visibility}`);
      console.log(`  ${chalk.dim("Hits:")}       ${site.hitCount ?? 0}`);
      console.log(`  ${chalk.dim("Storage:")}    ${site.storageUsedMb?.toFixed(2)} MB`);
      console.log(`  ${chalk.dim("Created:")}    ${new Date(site.createdAt).toLocaleString()}`);
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });
