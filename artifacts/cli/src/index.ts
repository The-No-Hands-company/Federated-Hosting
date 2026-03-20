#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand }    from "./commands/login.js";
import { logoutCommand }   from "./commands/logout.js";
import { whoamiCommand }   from "./commands/whoami.js";
import { deployCommand }   from "./commands/deploy.js";
import { sitesCommand }    from "./commands/sites.js";
import { tokensCommand }   from "./commands/tokens.js";
import { rollbackCommand } from "./commands/rollback.js";
import { analyticsCommand }from "./commands/analytics.js";
import { statusCommand }   from "./commands/status.js";
import { initCommand }     from "./commands/init.js";
import { logsCommand }     from "./commands/logs.js";
import { buildCommand }    from "./commands/build.js";
import { formsCommand }     from "./commands/forms.js";
import { completionCommand } from "./commands/completion.js";
import { envCommand }        from "./commands/env.js";
import { watchCommand }      from "./commands/watch.js";
import { createCommand }     from "./commands/create.js";

const program = new Command();

program
  .name("fh")
  .description("FedHost CLI — deploy static sites to your Federated Hosting node")
  .version("0.1.0");

program.addCommand(initCommand);
program.addCommand(createCommand);
program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(statusCommand);
program.addCommand(deployCommand);
program.addCommand(buildCommand);
program.addCommand(logsCommand);
program.addCommand(sitesCommand);
program.addCommand(formsCommand);
program.addCommand(tokensCommand);
program.addCommand(rollbackCommand);
program.addCommand(analyticsCommand);
program.addCommand(envCommand);
program.addCommand(watchCommand);
program.addCommand(completionCommand);

program.parse(process.argv);
