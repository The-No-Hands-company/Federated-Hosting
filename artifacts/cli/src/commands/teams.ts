import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { apiFetch } from "../api.js";

interface Member {
  id: number;
  userId: string;
  role: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

interface Invitation {
  id: number;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

function roleColor(role: string): string {
  switch (role) {
    case "admin":  return chalk.red(role);
    case "editor": return chalk.cyan(role);
    case "viewer": return chalk.dim(role);
    default:       return chalk.white(role);
  }
}

function memberName(m: Member): string {
  if (m.firstName) return `${m.firstName} ${m.lastName ?? ""}`.trim();
  return m.email ?? `user:${m.userId.slice(0, 8)}`;
}

export const teamsCommand = new Command("teams")
  .description("Manage site collaborators and invitations");

// ── nh teams list <site-id> ────────────────────────────────────────────────────

teamsCommand
  .command("list <site>")
  .description("List current members and pending invitations")
  .action(async (site: string) => {
    const siteId = parseInt(site, 10);
    if (isNaN(siteId)) { console.error(chalk.red("site must be a numeric site ID")); process.exit(1); }

    const spinner = ora("Fetching team").start();
    try {
      const [members, invitations] = await Promise.all([
        apiFetch<Member[]>(`/sites/${siteId}/members`),
        apiFetch<Invitation[]>(`/sites/${siteId}/invitations`),
      ]);
      spinner.stop();

      console.log();
      if (members.length > 0) {
        console.log(chalk.bold(`  Members (${members.length})`));
        console.log(chalk.dim("  " + "─".repeat(60)));
        for (const m of members) {
          const name  = memberName(m).padEnd(28);
          const email = (m.email ?? "").padEnd(30);
          const role  = roleColor(m.role.padEnd(8));
          console.log(`  ${chalk.cyan(String(m.id).padEnd(5))} ${name} ${email} ${role}`);
        }
        console.log();
      }

      if (invitations.length > 0) {
        console.log(chalk.bold(`  Pending invitations (${invitations.length})`));
        console.log(chalk.dim("  " + "─".repeat(60)));
        for (const inv of invitations) {
          const expires = new Date(inv.expiresAt).toLocaleDateString();
          console.log(
            `  ${chalk.yellow(String(inv.id).padEnd(5))} ${inv.email.padEnd(36)} ${roleColor(inv.role.padEnd(8))} ${chalk.dim(`expires ${expires}`)}`
          );
        }
        console.log();
      }

      if (members.length === 0 && invitations.length === 0) {
        console.log(chalk.dim("  No collaborators yet."));
        console.log(chalk.dim(`  Invite someone: nh teams invite ${siteId} their@email.com`));
        console.log();
      }
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

// ── nh teams invite <site-id> <email> [--role viewer|editor|admin] ────────────

teamsCommand
  .command("invite <site> <email>")
  .description("Send a collaboration invitation by email")
  .option("-r, --role <role>", "Role to assign: viewer, editor, admin", "editor")
  .action(async (site: string, email: string, opts: { role: string }) => {
    const siteId = parseInt(site, 10);
    if (isNaN(siteId)) { console.error(chalk.red("site must be a numeric site ID")); process.exit(1); }

    const validRoles = ["viewer", "editor", "admin"];
    if (!validRoles.includes(opts.role)) {
      console.error(chalk.red(`Invalid role '${opts.role}'. Must be: ${validRoles.join(", ")}`));
      process.exit(1);
    }

    const spinner = ora(`Inviting ${email} as ${opts.role}`).start();
    try {
      await apiFetch(`/sites/${siteId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), role: opts.role }),
      });
      spinner.succeed(chalk.green(`Invitation sent to ${email} (${opts.role})`));
      console.log(chalk.dim("  They'll receive an email with an accept link valid for 7 days."));
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

// ── nh teams role <site-id> <member-id> <role> ────────────────────────────────

teamsCommand
  .command("role <site> <member-id> <role>")
  .description("Change a member's role (viewer, editor)")
  .action(async (site: string, memberId: string, role: string) => {
    const siteId = parseInt(site, 10);
    const mId    = parseInt(memberId, 10);
    if (isNaN(siteId) || isNaN(mId)) {
      console.error(chalk.red("site and member-id must be numeric IDs")); process.exit(1);
    }

    if (!["editor", "viewer"].includes(role)) {
      console.error(chalk.red("Role must be 'editor' or 'viewer' (use 'nh teams remove' to remove admins)"));
      process.exit(1);
    }

    const spinner = ora(`Updating role to ${role}`).start();
    try {
      await apiFetch(`/sites/${siteId}/members/${mId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      spinner.succeed(chalk.green(`Member ${mId} role updated to ${roleColor(role)}`));
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

// ── nh teams remove <site-id> <member-id> ─────────────────────────────────────

teamsCommand
  .command("remove <site> <member-id>")
  .alias("kick")
  .description("Remove a member from the site")
  .option("-y, --yes", "Skip confirmation")
  .action(async (site: string, memberId: string, opts: { yes?: boolean }) => {
    const siteId = parseInt(site, 10);
    const mId    = parseInt(memberId, 10);
    if (isNaN(siteId) || isNaN(mId)) {
      console.error(chalk.red("site and member-id must be numeric IDs")); process.exit(1);
    }

    if (!opts.yes) {
      const { default: readline } = await import("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await new Promise<string>(res =>
        rl.question(chalk.yellow(`Remove member ${mId} from site ${siteId}? [y/N] `), res)
      );
      rl.close();
      if (ans.toLowerCase() !== "y") { console.log(chalk.dim("Cancelled.")); return; }
    }

    const spinner = ora("Removing member").start();
    try {
      await apiFetch(`/sites/${siteId}/members/${mId}`, { method: "DELETE" });
      spinner.succeed(chalk.green(`Member ${mId} removed.`));
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });

// ── nh teams revoke <site-id> <invite-id> ─────────────────────────────────────

teamsCommand
  .command("revoke <site> <invite-id>")
  .description("Revoke a pending invitation")
  .action(async (site: string, inviteId: string) => {
    const siteId = parseInt(site, 10);
    const iId    = parseInt(inviteId, 10);
    if (isNaN(siteId) || isNaN(iId)) {
      console.error(chalk.red("site and invite-id must be numeric IDs")); process.exit(1);
    }

    const spinner = ora("Revoking invitation").start();
    try {
      await apiFetch(`/sites/${siteId}/invitations/${iId}`, { method: "DELETE" });
      spinner.succeed(chalk.green(`Invitation ${iId} revoked.`));
    } catch (err: any) {
      spinner.fail(chalk.red(err.message));
      process.exit(1);
    }
  });
