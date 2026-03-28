import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiFetch } from "../api.js";

interface Site {
  id: number;
  domain: string;
  name: string;
}

interface CustomDomain {
  id: number;
  domain: string;
  status: "pending" | "verified" | "failed";
  verificationToken: string;
  verifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

function statusBadge(status: string): string {
  switch (status) {
    case "verified": return chalk.green("✓ verified");
    case "pending":  return chalk.yellow("⏳ pending");
    case "failed":   return chalk.red("✗ failed");
    default:         return chalk.dim(status);
  }
}

async function resolveSiteId(siteIdOrDomain: string): Promise<number> {
  const n = parseInt(siteIdOrDomain, 10);
  if (!isNaN(n)) return n;

  // Try to look up by domain
  const result = await apiFetch<{ data: Site[] }>(`/sites?domain=${encodeURIComponent(siteIdOrDomain)}&limit=1`);
  const site = result.data[0];
  if (!site) throw new Error(`No site found with domain '${siteIdOrDomain}'`);
  return site.id;
}

export const domainsCommand = new Command("domains")
  .description("Manage custom domains for a site");

// ── nh domains list <site-id> ─────────────────────────────────────────────────

domainsCommand
  .command("list <site>")
  .description("List custom domains for a site (accepts site ID or primary domain)")
  .action(async (site: string) => {
    const spinner = ora("Fetching domains").start();
    try {
      const siteId = await resolveSiteId(site);
      const domains = await apiFetch<CustomDomain[]>(`/sites/${siteId}/domains`);
      spinner.stop();

      if (domains.length === 0) {
        console.log(chalk.dim("  No custom domains added yet."));
        console.log(chalk.dim(`  Add one with: nh domains add ${siteId} <domain>`));
        return;
      }

      console.log();
      console.log(chalk.bold(`  ${"ID".padEnd(6)} ${"Domain".padEnd(40)} ${"Status".padEnd(18)} Verified`));
      console.log(chalk.dim("  " + "─".repeat(80)));

      for (const d of domains) {
        const verified = d.verifiedAt ? new Date(d.verifiedAt).toLocaleDateString() : "—";
        console.log(
          `  ${String(d.id).padEnd(6)} ${d.domain.padEnd(40)} ${statusBadge(d.status).padEnd(26)} ${verified}`
        );
        if (d.status === "failed" && d.lastError) {
          console.log(chalk.red(`         ↳ ${d.lastError}`));
        }
      }
      console.log();
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

// ── nh domains add <site-id> <domain> ────────────────────────────────────────

domainsCommand
  .command("add <site> <domain>")
  .description("Add a custom domain to a site")
  .action(async (site: string, domain: string) => {
    const spinner = ora(`Adding ${domain}`).start();
    try {
      const siteId = await resolveSiteId(site);
      const result = await apiFetch<CustomDomain>(`/sites/${siteId}/domains`, {
        method: "POST",
        body: JSON.stringify({ domain: domain.toLowerCase().trim() }),
      });
      spinner.succeed(chalk.green(`Domain added: ${result.domain}`));

      console.log();
      console.log(chalk.bold("DNS verification required:"));
      console.log();
      console.log(`  Add the following TXT record to your DNS provider:`);
      console.log();
      console.log(`  ${chalk.dim("Type:")}  TXT`);
      console.log(`  ${chalk.dim("Name:")}  ${chalk.cyan(`_fh-verify.${result.domain}`)}`);
      console.log(`  ${chalk.dim("Value:")} ${chalk.yellow(result.verificationToken)}`);
      console.log();
      console.log(`  Then run: ${chalk.cyan(`nh domains verify ${siteId} ${result.id}`)}`);
      console.log();
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

// ── nh domains verify <site-id> <domain-id> ──────────────────────────────────

domainsCommand
  .command("verify <site> <domain-id>")
  .description("Trigger DNS verification for a custom domain")
  .option("--watch", "Re-check every 15 seconds until verified or failed")
  .action(async (site: string, domainId: string, opts: { watch?: boolean }) => {
    const dId = parseInt(domainId, 10);
    if (isNaN(dId)) {
      console.error(chalk.red("domain-id must be a number. Get it from: nh domains list <site>"));
      process.exit(1);
    }

    async function check() {
      const spinner = ora("Checking DNS…").start();
      try {
        const result = await apiFetch<{ verified: boolean; domain: string; status: string; lastError: string | null }>(
          `/domains/${dId}/verify`,
          { method: "POST" },
        );
        if (result.verified) {
          spinner.succeed(chalk.green(`✓ ${result.domain} is verified and active!`));
          return true;
        } else {
          spinner.warn(chalk.yellow(`Not verified yet.`));
          if (result.lastError) console.log(chalk.dim(`  ${result.lastError}`));
          return false;
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        return false;
      }
    }

    const verified = await check();

    if (!verified && opts.watch) {
      console.log(chalk.dim("  Checking every 15s… (Ctrl+C to stop)"));
      const iv = setInterval(async () => {
        const done = await check();
        if (done) clearInterval(iv);
      }, 15_000);
    }
  });

// ── nh domains delete <domain-id> ────────────────────────────────────────────

domainsCommand
  .command("delete <domain-id>")
  .alias("rm")
  .description("Remove a custom domain")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (domainId: string, opts: { yes?: boolean }) => {
    const dId = parseInt(domainId, 10);
    if (isNaN(dId)) {
      console.error(chalk.red("domain-id must be a number. Get it from: nh domains list <site>"));
      process.exit(1);
    }

    if (!opts.yes) {
      const { default: readline } = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>(resolve =>
        rl.question(chalk.yellow(`Remove domain ${dId}? This cannot be undone. [y/N] `), resolve)
      );
      rl.close();
      if (answer.toLowerCase() !== "y") {
        console.log(chalk.dim("Cancelled."));
        return;
      }
    }

    const spinner = ora("Removing domain").start();
    try {
      await apiFetch(`/domains/${dId}`, { method: "DELETE" });
      spinner.succeed(chalk.green("Domain removed."));
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

// ── nh domains status <domain-id> ────────────────────────────────────────────

domainsCommand
  .command("tls-status <domain-id>")
  .description("Show TLS certificate status for a verified domain")
  .action(async (domainId: string) => {
    const dId = parseInt(domainId, 10);
    if (isNaN(dId)) { console.error(chalk.red("domain-id must be a number")); process.exit(1); }

    const spinner = ora("Checking TLS status").start();
    try {
      const result = await apiFetch<{
        domain: string; tlsStatus: string; certExpiry: string | null;
        daysUntilExpiry: number | null; acmeEnabled: boolean;
      }>(`/domains/${dId}/tls-status`);
      spinner.stop();

      console.log();
      console.log(chalk.bold(`  TLS status for ${result.domain}`));
      console.log(`  Status:     ${result.tlsStatus === "valid" ? chalk.green(result.tlsStatus) : chalk.yellow(result.tlsStatus)}`);
      if (result.certExpiry) {
        const expiry = new Date(result.certExpiry).toLocaleDateString();
        const daysLeft = result.daysUntilExpiry ?? 0;
        const color = daysLeft < 14 ? chalk.red : daysLeft < 30 ? chalk.yellow : chalk.green;
        console.log(`  Cert expiry: ${color(`${expiry} (${daysLeft} days)`)}`);
      }
      console.log(`  ACME:       ${result.acmeEnabled ? chalk.green("enabled") : chalk.dim("disabled")}`);
      if (!result.acmeEnabled) {
        console.log(chalk.dim("  Set ACME_ENABLED=true on the node to auto-provision TLS."));
      }
      console.log();
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });
