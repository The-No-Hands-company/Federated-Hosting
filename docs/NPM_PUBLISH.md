# Publishing `@fedhost/cli` to npm

## Prerequisites

1. npm account at npmjs.com
2. Member of (or owner of) the `fedhost` npm organisation
3. `NPM_TOKEN` secret set in the GitHub repository

---

## One-time setup

### 1. Create the npm organisation

```bash
# Log in to npm
npm login

# Create the @fedhost organisation (if it doesn't exist)
# Go to: https://www.npmjs.com/org/create
# Organisation name: fedhost
# Visibility: Public (free)
```

Or via CLI:
```bash
npm org create fedhost
```

### 2. Add team members

```bash
npm team add fedhost:developers <username>
```

### 3. Generate an automation token

1. Go to npmjs.com → Account Settings → Access Tokens
2. Click **Generate New Token** → **Granular Access Token**
3. Set:
   - Token name: `fedhost-cli-publish`
   - Expiration: 365 days (rotate annually)
   - Packages and scopes: **Read and write** → `@fedhost/cli`
   - Organisations: `fedhost` (read-only)
4. Copy the token — you only see it once

### 4. Add the token to GitHub

```
GitHub repo → Settings → Secrets and variables → Actions → New repository secret
Name:  NPM_TOKEN
Value: npm_xxxxxxxxxxxxxxxxxxxx
```

---

## Publishing

### Automatic (recommended)

The `publish-cli.yml` workflow triggers on:

**Manual dispatch** (with optional version bump):
1. GitHub repo → Actions → "Publish @fedhost/cli to npm"
2. Click **Run workflow**
3. Optionally enter a version like `0.2.0`
4. Click **Run workflow**

**Git tag** (automatic on push):
```bash
git tag cli-v0.2.0
git push origin cli-v0.2.0
```

### Manual (if needed)

```bash
cd artifacts/cli
pnpm run build          # produces dist/index.js
npm publish --access public
```

---

## Version management

Follow semantic versioning:

| Change type | Example | Version bump |
|---|---|---|
| Bug fix | Fix rollback crash | `0.1.1` |
| New feature | Add `fh logs` command | `0.2.0` |
| Breaking change | Rename `fh deploy` flags | `1.0.0` |

Update `artifacts/cli/package.json` version before publishing, or let the workflow handle it with the version input.

---

## Verification

After publishing:

```bash
# Install globally and verify
npm install -g @fedhost/cli@latest
fh --version   # should print the new version
fh --help
```

Check the package page: https://www.npmjs.com/package/@fedhost/cli

---

## Troubleshooting

**`403 Forbidden`** — Token doesn't have write access to `@fedhost/cli`. Regenerate with correct scopes.

**`402 Payment Required`** — The `fedhost` organisation doesn't exist or package is set to private. Run `npm publish --access public`.

**`ENEEDAUTH`** — `NPM_TOKEN` secret is not set or expired in GitHub Actions.

**`EPUBLISHCONFLICT`** — Version already exists on npm. Bump the version and republish.
