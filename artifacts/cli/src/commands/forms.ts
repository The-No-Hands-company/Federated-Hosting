import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import fs from "fs";
import { requireAuth } from "../config.js";
import { apiFetch } from "../api.js";

interface Submission {
  id: number;
  formName: string;
  data: Record<string, string>;
  spamScore: number;
  flagged: number;
  read: number;
  createdAt: string;
}

interface FormsResponse {
  data: Submission[];
  meta: { total: number; page: number; limit: number };
  forms: Array<{ formName: string; count: number }>;
}

export const formsCommand = new Command("forms")
  .description("View and manage form submissions")
  .argument("<site-id>", "Site ID")
  .option("--form <name>",    "Filter by form name")
  .option("--limit <n>",      "Number of submissions to show", "20")
  .option("--export <file>",  "Export to CSV file")
  .option("--json",           "Output as JSON")
  .option("--unread",         "Show only unread submissions")
  .action(async (siteId: string, opts: {
    form?: string;
    limit?: string;
    export?: string;
    json?: boolean;
    unread?: boolean;
  }) => {
    const cfg = requireAuth();

    if (opts.export && opts.form) {
      // CSV export
      const spinner = ora("  Exporting submissions…").start();
      const url = `/sites/${siteId}/forms/${opts.form}/export`;
      const res = await fetch(`${cfg.nodeUrl}/api${url}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (!res.ok) { spinner.fail("Export failed"); process.exit(1); }
      const csv = await res.text();
      fs.writeFileSync(opts.export, csv);
      spinner.succeed(chalk.green(`  Exported to ${opts.export}`));
      return;
    }

    const spinner = ora("  Fetching submissions…").start();
    const qs = new URLSearchParams({
      limit: opts.limit ?? "20",
      ...(opts.form ? { form: opts.form } : {}),
    });

    const { data, meta, forms } = await apiFetch<FormsResponse>(
      cfg, `/sites/${siteId}/forms?${qs}`
    );
    spinner.stop();

    const filtered = opts.unread ? data.filter(s => !s.read) : data;

    if (opts.json) {
      console.log(JSON.stringify({ data: filtered, meta, forms }, null, 2));
      return;
    }

    if (forms.length > 0) {
      console.log();
      console.log(chalk.bold("  Forms on this site:\n"));
      for (const f of forms) {
        console.log(`  ${chalk.cyan(f.formName.padEnd(24))} ${chalk.dim(`${f.count} submissions`)}`);
      }
    }

    if (filtered.length === 0) {
      console.log(chalk.dim("\n  No submissions found."));
      return;
    }

    console.log();
    console.log(chalk.bold(`  ${filtered.length} submission${filtered.length !== 1 ? "s" : ""} (${meta.total} total)\n`));

    for (const sub of filtered) {
      const unreadMark = sub.read ? "  " : chalk.cyan("• ");
      const spam = sub.flagged ? chalk.red(" [spam]") : "";
      const date = new Date(sub.createdAt).toLocaleString();
      console.log(`${unreadMark}${chalk.dim(`#${sub.id}`)}  ${chalk.bold(sub.formName)}${spam}  ${chalk.dim(date)}`);
      for (const [key, val] of Object.entries(sub.data)) {
        const truncated = String(val).length > 80 ? String(val).slice(0, 77) + "…" : String(val);
        console.log(`    ${chalk.dim(key + ":")} ${truncated}`);
      }
      console.log();
    }

    if (opts.form) {
      console.log(chalk.dim(`  Export: nh forms ${siteId} --form ${opts.form} --export submissions.csv`));
    }
  });
