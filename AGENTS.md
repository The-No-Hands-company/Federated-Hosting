# Nexus Hosting

Nexus-Hosting is an ecosystem execution surface for hosted workloads, sites, and supporting libraries.

## Standards Enforcement

- Follow ../docs/ENGINEERING_STANDARDS.md as the baseline for workspace quality, API behavior, security, and testing.
- Preserve the rule that Nexus-Cloud is the ecosystem nerve system. Hosting integrates with that control plane; it does not replace it.
- Prefer event-driven deployment, status, and lifecycle propagation over polling-only behavior.
- Preserve graceful degradation and local-first behavior where hosted workloads can continue serving despite partial control-plane disruption.

## Workspace Conventions

- Use pnpm for workspace package management.
- Keep changes scoped to the package or crate actually being modified.
- If touching TypeScript workspace packages, keep strict typing and formatter/lint baselines intact.
- If touching Rust crates, run formatting and lint checks for the affected crate or workspace surface before handoff.

## Validation Target

- `pnpm run typecheck`
- package-local lint/test/build commands for the specific workspace member you touched