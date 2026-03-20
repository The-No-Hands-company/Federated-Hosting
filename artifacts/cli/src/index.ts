#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { deployCommand } from "./commands/deploy.js";
import { sitesCommand } from "./commands/sites.js";
import { tokensCommand } from "./commands/tokens.js";
import { rollbackCommand } from "./commands/rollback.js";

const program = new Command();

program
  .name("fh")
  .description("FedHost CLI — deploy sites to your Federated Hosting node")
  .version("0.1.0");

program.addCommand(loginCommand);
program.addCommand(deployCommand);
program.addCommand(sitesCommand);
program.addCommand(tokensCommand);
program.addCommand(rollbackCommand);

program.parse(process.argv);
