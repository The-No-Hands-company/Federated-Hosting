# Publishing @nexushosting/cli to npm

The CLI is published to npm as `@nexushosting/cli`. Publishing is handled by a GitHub Actions workflow.

## Setup (one-time)

1. Create an npm account and organisation at npmjs.com if you haven't already
2. Go to npmjs.com → Account → Access Tokens → Generate New Token
   - Token type: **Automation** (not Publish or Read-only)
   - Permission: **Read and Write** on the `@nexushosting` scope
3. Add the token to the GitHub repository:
   - Repository → Settings → Secrets and variables → Actions → New repository secret
   - Name: `NPM_TOKEN`
   - Value: the token from step 2

## Publishing a new version

### Manual (via GitHub Actions UI)

1. Go to the repository → Actions → **Publish @nexushosting/cli to npm**
2. Click **Run workflow**
3. Enter a version number (e.g. `0.2.0`) or leave blank to use `package.json`
4. Click **Run workflow**

The workflow will:
- Build the CLI bundle via esbuild
- Run `npm publish --dry-run` to verify the output
- Publish to the `@nexushosting` scope on npmjs.com
- Tag the release as `cli-v<version>` in git

### Automatic (via git tag)

```bash
cd artifacts/cli
npm version 0.2.0 --no-git-tag-version
git add .
git commit -m "chore: bump @nexushosting/cli to 0.2.0"
git tag cli-v0.2.0
git push origin main --tags
```

Pushing a `cli-v*` tag triggers the publish workflow automatically.

## Versioning

The CLI follows semantic versioning independently of the server:
- **Patch** (0.1.x): bug fixes, non-breaking flag additions
- **Minor** (0.x.0): new commands, new flags, backwards-compatible changes
- **Major** (x.0.0): breaking flag/command changes, minimum Node version bumps

The current version is in `artifacts/cli/package.json`.
