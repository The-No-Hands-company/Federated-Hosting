import { Command } from "commander";
import chalk from "chalk";

const BASH_COMPLETION = `
# fh bash completion
# Add to ~/.bashrc: eval "$(fh completion bash)"

_fh_completion() {
  local cur prev words cword
  _init_completion || return

  local commands="init login logout whoami status deploy build logs sites forms tokens rollback analytics completion"

  case "$prev" in
    fh)
      COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
      return ;;
    deploy|logs|forms|build|analytics|rollback)
      # Site IDs — would need live completion from API, suggest numeric
      COMPREPLY=( $(compgen -W "" -- "$cur") )
      return ;;
    --node)
      COMPREPLY=( $(compgen -W "https://" -- "$cur") )
      return ;;
  esac

  case "$cur" in
    -*)
      case "$prev" in
        deploy)   COMPREPLY=( $(compgen -W "--node --token" -- "$cur") ) ;;
        build)    COMPREPLY=( $(compgen -W "--git-url --branch --command --output --env --install --staging --wait" -- "$cur") ) ;;
        logs)     COMPREPLY=( $(compgen -W "--build --follow --limit" -- "$cur") ) ;;
        forms)    COMPREPLY=( $(compgen -W "--form --limit --export --json --unread" -- "$cur") ) ;;
        sites)    COMPREPLY=( $(compgen -W "--json --limit" -- "$cur") ) ;;
        analytics)COMPREPLY=( $(compgen -W "--period --json" -- "$cur") ) ;;
        whoami)   COMPREPLY=( $(compgen -W "--json" -- "$cur") ) ;;
        login)    COMPREPLY=( $(compgen -W "--node --token" -- "$cur") ) ;;
        *)        COMPREPLY=( $(compgen -W "--help --version" -- "$cur") ) ;;
      esac ;;
  esac
}

complete -F _fh_completion fh
`.trim();

const ZSH_COMPLETION = `
# fh zsh completion
# Add to ~/.zshrc: eval "$(fh completion zsh)"

_fh() {
  local state

  _arguments \\
    '1: :->command' \\
    '*: :->args' && return 0

  case $state in
    command)
      local commands=(
        'init:Initialise a new site in the current directory'
        'login:Authenticate with a FedHost node'
        'logout:Remove stored credentials'
        'whoami:Show current authenticated user'
        'status:Show site deployment status'
        'deploy:Deploy files to your site'
        'build:Trigger a git-based build pipeline'
        'logs:View build logs'
        'sites:List your sites'
        'forms:View form submissions'
        'tokens:Manage API tokens'
        'rollback:Rollback to a previous deployment'
        'analytics:View site analytics'
        'completion:Generate shell completion script'
      )
      _describe 'command' commands ;;

    args)
      case $words[2] in
        build)
          _arguments \\
            '--git-url[Git repository URL]:url' \\
            '--branch[Branch to build]:branch' \\
            '--command[Build command]:command' \\
            '--output[Output directory]:dir:_directories' \\
            '--env[Environment variable KEY=VALUE]:env' \\
            '--install[Override install command]:command' \\
            '--staging[Deploy to staging]' \\
            '--wait[Wait for completion]' ;;
        logs)
          _arguments \\
            '--build[Build ID]:id' \\
            '--follow[Poll for updates]' \\
            '--limit[Number of builds]:n' ;;
        forms)
          _arguments \\
            '--form[Form name]:name' \\
            '--limit[Number of submissions]:n' \\
            '--export[Export to CSV file]:file:_files' \\
            '--json[Output as JSON]' \\
            '--unread[Show only unread]' ;;
        analytics)
          _arguments \\
            '--period[Time period (24h|7d|30d)]:period:(24h 7d 30d)' \\
            '--json[Output as JSON]' ;;
      esac ;;
  esac
}

_fh "$@"
`.trim();

const FISH_COMPLETION = `
# fh fish completion
# Save to ~/.config/fish/completions/fh.fish

set -l commands init login logout whoami status deploy build logs sites forms tokens rollback analytics completion

complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a init      -d "Initialise a new site"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a login     -d "Authenticate with a node"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a logout    -d "Remove stored credentials"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a whoami    -d "Show current user"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a status    -d "Show deployment status"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a deploy    -d "Deploy files"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a build     -d "Trigger git build"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a logs      -d "View build logs"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a sites     -d "List sites"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a forms     -d "View form submissions"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a tokens    -d "Manage API tokens"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a rollback  -d "Rollback deployment"
complete -c fh -f -n "not __fish_seen_subcommand_from $commands" -a analytics -d "View analytics"

# build flags
complete -c fh -n "__fish_seen_subcommand_from build" -l git-url  -d "Git repository URL"
complete -c fh -n "__fish_seen_subcommand_from build" -l branch   -d "Branch to build"
complete -c fh -n "__fish_seen_subcommand_from build" -l command  -d "Build command"
complete -c fh -n "__fish_seen_subcommand_from build" -l output   -d "Output directory"
complete -c fh -n "__fish_seen_subcommand_from build" -l env      -d "Env var KEY=VALUE"
complete -c fh -n "__fish_seen_subcommand_from build" -l staging  -d "Deploy to staging"
complete -c fh -n "__fish_seen_subcommand_from build" -l wait     -d "Wait for completion"

# logs flags
complete -c fh -n "__fish_seen_subcommand_from logs" -l build  -d "Build ID"
complete -c fh -n "__fish_seen_subcommand_from logs" -l follow -d "Poll for updates"
complete -c fh -n "__fish_seen_subcommand_from logs" -l limit  -d "Number of builds"

# analytics flags
complete -c fh -n "__fish_seen_subcommand_from analytics" -l period -a "24h 7d 30d" -d "Time period"
`.trim();

export const completionCommand = new Command("completion")
  .description("Generate shell completion script")
  .argument("<shell>", "Shell type: bash, zsh, or fish")
  .addHelpText("after", `
Examples:
  # Bash — add to ~/.bashrc
  eval "$(fh completion bash)"

  # Zsh — add to ~/.zshrc
  eval "$(fh completion zsh)"

  # Fish — install directly
  fh completion fish > ~/.config/fish/completions/fh.fish
`)
  .action((shell: string) => {
    switch (shell.toLowerCase()) {
      case "bash":
        console.log(BASH_COMPLETION);
        break;
      case "zsh":
        console.log(ZSH_COMPLETION);
        break;
      case "fish":
        console.log(FISH_COMPLETION);
        break;
      default:
        console.error(chalk.red(`Unknown shell: ${shell}`));
        console.error(chalk.dim("Supported shells: bash, zsh, fish"));
        process.exit(1);
    }
  });
