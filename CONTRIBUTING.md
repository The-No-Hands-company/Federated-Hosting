# Contributing

Thank you for considering a contribution to Federated Hosting. This document covers how to set up a local development environment, the code style we follow, and the process for submitting changes.

---

## Code of Conduct

Be respectful and constructive. Harassment of any kind will not be tolerated. We are here to build software together.

---

## Getting Started

### 1. Fork and clone

```bash
git clone https://github.com/your-username/Federated-Hosting.git
cd Federated-Hosting
```

### 2. Install dependencies

```bash
# Requires pnpm 10+ and Node.js 24+
pnpm install
```

### 3. Set up environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Required variables:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/fedhosting
DEFAULT_OBJECT_STORAGE_BUCKET_ID=your-bucket-id
PRIVATE_OBJECT_DIR=private
PUBLIC_OBJECT_SEARCH_PATHS=public
NODE_ENV=development
```

### 4. Initialise the database

```bash
pnpm --filter @workspace/db run push
```

### 5. Start development servers

```bash
# API server (port 8080)
pnpm --filter @workspace/api-server run dev

# Frontend (port 25231)
pnpm --filter @workspace/federated-hosting run dev
```

---

## Repository Layout

```
artifacts/api-server/     Express 5 API + federation node
artifacts/federated-hosting/  React + Vite frontend
lib/db/                   Drizzle ORM schema + migrations
lib/api-spec/             OpenAPI 3.1 specification (source of truth)
lib/api-zod/              Auto-generated Zod validators (do not edit)
lib/api-client-react/     Auto-generated React Query hooks (do not edit)
lib/integrations/         OIDC Auth + Object Storage wrappers
docs/                     Architecture, API, and other documentation
scripts/                  Utility and seed scripts
```

---

## Development Workflow

### Branches

- `main` — production-ready code; protected
- `feat/<name>` — new features
- `fix/<name>` — bug fixes
- `chore/<name>` — tooling, deps, docs

### Making changes

1. Create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes following the code style guidelines below.

3. Type-check from the root (required — checks cross-package imports):
   ```bash
   pnpm run typecheck
   ```

4. Test your changes manually (automated test suite coming soon).

5. Commit with a clear message:
   ```bash
   git commit -m "feat: add per-site bandwidth tracking"
   ```

6. Push and open a pull request against `main`.

### Commit message format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`

---

## Code Style

### TypeScript

- Strict mode enabled — no `any`, no implicit returns
- Prefer `const`; use `let` only when reassignment is necessary
- Use named exports over default exports in library code
- All route handlers must be wrapped in `asyncHandler()` — no bare `async` handlers
- Throw `AppError` (not raw `Error`) from route handlers; the global error handler will serialise it correctly
- Never `console.log` in production code — use the `logger` from `lib/logger.ts`

### Express routes

```ts
// Good
router.get("/things", asyncHandler(async (req, res) => {
  const things = await db.select().from(thingsTable);
  res.json(things);
}));

// Bad — unhandled promise rejection will crash the process
router.get("/things", async (req, res) => {
  const things = await db.select().from(thingsTable);
  res.json(things);
});
```

### Error handling

```ts
// Throw typed errors — they get serialised consistently
if (!thing) throw AppError.notFound("Thing not found");
if (!req.isAuthenticated()) throw AppError.unauthorized();
if (badInput) throw AppError.badRequest("Explain what was wrong", "MACHINE_CODE");
```

### Database

- Always use Drizzle's query builder — no raw SQL strings unless absolutely necessary
- Wrap multi-step operations in `db.transaction()`
- Add indexes for any column used in a `WHERE` clause on high-traffic paths
- Run `pnpm --filter @workspace/db run push` after schema changes — never write manual migration SQL

### API schema

The **OpenAPI spec** (`lib/api-spec/`) is the single source of truth for request/response shapes. If you add or change an endpoint:

1. Update `lib/api-spec/openapi.yaml`
2. Regenerate clients: `pnpm --filter @workspace/api-zod run generate && pnpm --filter @workspace/api-client-react run generate`
3. Update the route to match the new schema

### Frontend

- Components go in `src/components/` (shared) or `src/pages/` (page-level)
- Use `useQuery` / `useMutation` from the generated `@workspace/api-client-react` hooks — don't write `fetch` calls by hand
- Wrap any new major page section in `<ErrorBoundary>` if it fetches remote data
- Prefer Tailwind utility classes; avoid inline styles
- Keep components small — split into sub-components when a file exceeds ~200 lines

---

## Adding a Federation Peer

To connect two local development nodes for testing:

1. Start both nodes (each with their own `DATABASE_URL` and port)
2. Register the peer in Node A's DB:
   ```bash
   curl -X POST http://localhost:8080/api/nodes \
     -H "Content-Type: application/json" \
     -d '{ "name": "Node B", "domain": "localhost:8082", "region": "local" }'
   ```
3. Generate keys for both nodes via `POST /api/nodes/:id/generate-keys`
4. Initiate handshake from Node A:
   ```bash
   curl -X POST http://localhost:8080/api/federation/handshake \
     -H "Content-Type: application/json" \
     -d '{ "targetNodeUrl": "http://localhost:8082" }'
   ```

---

## Reporting Bugs

Open a [GitHub issue](https://github.com/The-No-Hands-company/Federated-Hosting/issues) with:

- A clear title describing the problem
- Steps to reproduce
- Expected vs. actual behaviour
- Node.js version, OS, relevant environment details

For security vulnerabilities, see [SECURITY.md](./SECURITY.md) — **do not open a public issue**.

---

## Pull Request Checklist

- [ ] Branch is up to date with `main`
- [ ] `pnpm run typecheck` passes with no errors
- [ ] New endpoints have corresponding OpenAPI spec entries
- [ ] New list endpoints use `parsePagination` + `buildPaginatedResponse`
- [ ] New route handlers are wrapped in `asyncHandler`
- [ ] Schema changes are reflected in `lib/db` and pushed with `pnpm --filter @workspace/db run push`
- [ ] Commit messages follow Conventional Commits
- [ ] `docs/CHANGELOG.md` updated with a summary of changes

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
