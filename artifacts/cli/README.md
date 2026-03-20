# @fedhost/cli

The official CLI for [Federated Hosting](https://github.com/The-No-Hands-company/Federated-Hosting) — deploy static sites to any FedHost node from your terminal or CI pipeline.

## Install

```bash
npm install -g @fedhost/cli
# or
pnpm add -g @fedhost/cli
```

## Quick start

```bash
fh login --node https://your-node.example.com  # authenticate
fh deploy ./dist --site 42                      # deploy files
fh status                                        # confirm live
```

## Shell completion

```bash
eval "$(fh completion bash)"   # Bash — add to ~/.bashrc
eval "$(fh completion zsh)"    # Zsh  — add to ~/.zshrc
fh completion fish > ~/.config/fish/completions/fh.fish
```

## Commands

### Account
| `fh login --node <url>` | Authenticate with a node |
| `fh logout` | Remove credentials |
| `fh whoami` | Show current user and node |
| `fh init` | Init site config in current directory |

### Creating new projects
```bash
fh create my-site              # interactive template picker
fh create my-site --template vite    # React + Vite
fh create my-site --template astro   # Astro
fh create my-site --template nextjs  # Next.js static export
fh create my-site --template svelte  # SvelteKit
fh create my-site --template html    # Plain HTML
```

### Deploying
| `fh deploy <dir>` | Upload files and deploy |
| `fh deploy <dir> --staging` | Deploy to staging |
| `fh rollback <site-id>` | Roll back to previous deployment |
| `fh status` | Show deployment status |

### Git builds
```bash
fh build <site-id> --git-url https://github.com/org/repo
fh build <site-id> --branch main --command "npm run build" --output dist --wait
fh logs  <site-id>                         # list recent builds
fh logs  <site-id> --build 42 --follow     # stream a build log
```

### Environment variables (injected into builds)
```bash
fh env list  <site-id>
fh env set   <site-id> VITE_API_URL https://api.example.com
fh env set   <site-id> MY_SECRET abc123 --secret
fh env unset <site-id> VITE_API_URL
fh env pull  <site-id>   # print as export statements
```

### Forms, analytics, tokens
```bash
fh forms     <site-id> [--form contact] [--export file.csv] [--unread]
fh analytics <site-id> [--period 7d|30d]
fh sites
fh tokens
```

## CI / GitHub Actions

```yaml
- uses: actions/setup-node@v4
  with: {node-version: 24}
- run: npm install -g @fedhost/cli && fh deploy ./dist --site ${{ vars.SITE_ID }}
  env:
    FH_NODE_URL: ${{ vars.FH_NODE_URL }}
    FH_TOKEN:    ${{ secrets.FH_TOKEN }}
```
