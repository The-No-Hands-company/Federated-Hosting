import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { requireAuth } from "../config.js";
import { apiFetch } from "../api.js";

interface BuildJob {
  id: number;
  status: string;
  gitBranch: string;
  buildCommand: string;
  log: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface BuildsResponse {
  data: BuildJob[];
  meta: { total: number; page: number; limit: number };
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
  queued:    chalk.dim,
  running:   chalk.cyan,
  success:   chalk.green,
  failed:    chalk.red,
  cancelled: chalk.yellow,
};

export const logsCommand = new Command("logs")
  .description("View build logs for a site")
  .argument("<site-id>", "Site ID")
  .option("--build <id>", "Specific build ID to view logs for")
  .option("--follow", "Poll for updates while build is running (every 3s)")
  .option("--limit <n>", "Number of recent builds to list", "10")
  .action(async (siteId: string, opts: { build?: string; follow?: boolean; limit?: string }) => {
    const cfg = requireAuth();
    const spinner = ora("  Fetching builds…").start();

    if (opts.build) {
      // Show full log for a specific build
      spinner.text = `  Fetching build #${opts.build}…`;
      const build = await apiFetch<BuildJob>(cfg, `/sites/${siteId}/builds/${opts.build}`);
      spinner.stop();
      printBuildHeader(build);
      console.log();
      if (build.log) {
        process.stdout.write(build.log);
        if (!build.log.endsWith("\n")) console.log();
      } else {
        console.log(chalk.dim("  No log output yet."));
      }

      // Follow mode: poll while running
      if (opts.follow && build.status === "running") {
        let last = build.log?.length ?? 0;
        while (true) {
          await new Promise(r => setTimeout(r, 3000));
          const updated = await apiFetch<BuildJob>(cfg, `/sites/${siteId}/builds/${opts.build}`);
          if (updated.log && updated.log.length > last) {
            process.stdout.write(updated.log.slice(last));
            last = updated.log.length;
          }
          if (updated.status !== "running") {
            console.log();
            console.log(STATUS_COLOR[updated.status]?.(`  Build ${updated.status}.`) ?? `  Build ${updated.status}.`);
            break;
          }
        }
      }
      return;
    }

    // List recent builds
    const { data: builds } = await apiFetch<BuildsResponse>(cfg, `/sites/${siteId}/builds?limit=${opts.limit}`);
    spinner.stop();

    if (builds.length === 0) {
      console.log(chalk.dim("  No builds yet. Run: nh build <site-id>"));
      return;
    }

    console.log();
    console.log(chalk.bold(`  Recent builds for site ${siteId}\n`));

    for (const b of builds) {
      const color = STATUS_COLOR[b.status] ?? chalk.white;
      const duration = b.startedAt && b.finishedAt
        ? `  ${((new Date(b.finishedAt).getTime() - new Date(b.startedAt).getTime()) / 1000).toFixed(0)}s`
        : "";
      console.log(
        `  ${chalk.dim(`#${b.id}`)}  ${color(b.status.padEnd(10))}  ` +
        `${chalk.cyan(b.gitBranch.padEnd(20))}  ${chalk.dim(duration)}  ` +
        chalk.dim(new Date(b.createdAt).toLocaleString())
      );
    }
    console.log();
    console.log(chalk.dim(`  View full log: nh logs ${siteId} --build <id>`));
    console.log();
  });

function printBuildHeader(b: BuildJob) {
  const color = STATUS_COLOR[b.status] ?? chalk.white;
  console.log();
  console.log(`  Build ${chalk.dim(`#${b.id}`)} — ${color(b.status)}`);
  console.log(`  ${chalk.dim("Branch:")}  ${chalk.cyan(b.gitBranch)}`);
  console.log(`  ${chalk.dim("Command:")} ${b.buildCommand}`);
  if (b.startedAt) {
    console.log(`  ${chalk.dim("Started:")} ${new Date(b.startedAt).toLocaleString()}`);
  }
  if (b.finishedAt) {
    const dur = ((new Date(b.finishedAt).getTime() - new Date(b.startedAt!).getTime()) / 1000).toFixed(0);
    console.log(`  ${chalk.dim("Duration:")} ${dur}s`);
  }
}
