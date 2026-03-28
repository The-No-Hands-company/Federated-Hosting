import { Command } from "commander";
import chalk from "chalk";
import { clearConfig, getConfig } from "../config.js";

export const logoutCommand = new Command("logout")
  .description("Remove stored credentials for the current node")
  .action(() => {
    const cfg = getConfig();
    if (!cfg.nodeUrl && !cfg.token) {
      console.log(chalk.dim("  Not logged in — nothing to clear."));
      return;
    }
    clearConfig();
    console.log(chalk.green("  Logged out.") + chalk.dim(` Credentials for ${cfg.nodeUrl ?? "unknown node"} removed.`));
    console.log(chalk.dim(`  Run ${chalk.white("nh login")} to authenticate again.`));
  });
