# @nexushosting/cli

The official CLI for [Nexus Hosting](https://github.com/The-No-Hands-company/Nexus-Hosting) — deploy static sites to any NexusHosting node from your terminal or CI pipeline.

## Install

```bash
npm install -g @nexushosting/cli
# or
pnpm add -g @nexushosting/cli
```

## Quick start

```bash
nh login --node https://your-node.example.com  # authenticate
nh deploy ./dist --site 42                      # deploy files
nh status                                        # confirm live
```

## Shell completion

```bash
eval "$(nh completion bash)"   # Bash — add to ~/.bashrc
eval "$(nh completion zsh)"    # Zsh  — add to ~/.zshrc
nh completion fish > ~/.config/fish/completions/fh.fish
```

## Commands

### Account
| `nh login --node <url>` | Authenticate with a node |
| `nh logout` | Remove credentials |
| `nh whoami` | Show current user and node |
| `nh init` | Init site config in current directory |

### Creating new projects
```bash
nh create my-site              # interactive template picker
nh create my-site --template vite    # React + Vite
nh create my-site --template astro   # Astro
nh create my-site --template nextjs  # Next.js static export
nh create my-site --template svelte  # SvelteKit
nh create my-site --template html    # Plain HTML
```

### Deploying
| `nh deploy <dir>` | Upload files and deploy |
| `nh deploy <dir> --staging` | Deploy to staging |
| `nh rollback <site-id>` | Roll back to previous deployment |
| `nh status` | Show deployment status |

### Git builds
```bash
nh build <site-id> --git-url https://github.com/org/repo
nh build <site-id> --branch main --command "npm run build" --output dist --wait
nh logs  <site-id>                         # list recent builds
nh logs  <site-id> --build 42 --follow     # stream a build log
```

### Environment variables (injected into builds)
```bash
nh env list  <site-id>
nh env set   <site-id> VITE_API_URL https://api.example.com
nh env set   <site-id> MY_SECRET abc123 --secret
nh env unset <site-id> VITE_API_URL
nh env pull  <site-id>   # print as export statements
```

### Forms, analytics, tokens
```bash
nh forms     <site-id> [--form contact] [--export file.csv] [--unread]
nh analytics <site-id> [--period 7d|30d]
nh sites
nh tokens
```

## CI / GitHub Actions

```yaml
- uses: actions/setup-node@v4
  with: {node-version: 24}
- run: npm install -g @nexushosting/cli && nh deploy ./dist --site ${{ vars.SITE_ID }}
  env:
    FH_NODE_URL: ${{ vars.FH_NODE_URL }}
    FH_TOKEN:    ${{ secrets.FH_TOKEN }}
```
