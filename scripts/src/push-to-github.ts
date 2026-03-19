import { execSync } from "child_process";

const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const repoUrl = `https://x-access-token:${token}@github.com/The-No-Hands-company/Federated-Hosting.git`;

if (!token) {
  console.error("GITHUB_PERSONAL_ACCESS_TOKEN is not set");
  process.exit(1);
}

try {
  // Configure git user
  execSync('git config user.email "erichakansson84@gmail.com"', { stdio: "inherit", cwd: "/home/runner/workspace" });
  execSync('git config user.name "Zajfan"', { stdio: "inherit", cwd: "/home/runner/workspace" });

  // Remove existing github remote if it exists
  try {
    execSync("git remote remove github", { stdio: "pipe", cwd: "/home/runner/workspace" });
  } catch {
    // Ignore if remote doesn't exist
  }

  // Add the remote with token
  execSync(`git remote add github "${repoUrl}"`, { stdio: "inherit", cwd: "/home/runner/workspace" });

  // Push to main branch
  execSync("git push github master:main", { stdio: "inherit", cwd: "/home/runner/workspace" });

  console.log("✅ Successfully pushed to GitHub!");
} catch (err) {
  console.error("Push failed:", err);
  process.exit(1);
}
