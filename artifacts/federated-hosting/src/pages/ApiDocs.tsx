import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Check, FileCode, BookOpen } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Endpoint groups for the quick-reference table
const ENDPOINT_GROUPS = [
  {
    tag: "Health",
    color: "text-status-active",
    bg: "bg-status-active/10 border-status-active/20",
    endpoints: [
      { method: "GET", path: "/api/health",       description: "Full health check" },
      { method: "GET", path: "/api/health/live",  description: "Liveness probe" },
      { method: "GET", path: "/api/health/ready", description: "Readiness probe" },
    ],
  },
  {
    tag: "Sites",
    color: "text-primary",
    bg: "bg-primary/10 border-primary/20",
    endpoints: [
      { method: "GET",    path: "/api/sites",                               description: "List sites (paginated)" },
      { method: "POST",   path: "/api/sites",                               description: "Create site" },
      { method: "GET",    path: "/api/sites/:id",                           description: "Get site" },
      { method: "PATCH",  path: "/api/sites/:id",                           description: "Update site" },
      { method: "DELETE", path: "/api/sites/:id",                           description: "Delete site" },
      { method: "POST",   path: "/api/sites/:id/files/upload-url",          description: "Presigned upload URL" },
      { method: "POST",   path: "/api/sites/:id/files",                     description: "Register uploaded file" },
      { method: "POST",   path: "/api/sites/:id/deploy",                    description: "Deploy site" },
      { method: "GET",    path: "/api/sites/:id/deployments",               description: "Deployment history" },
      { method: "POST",   path: "/api/sites/:id/deployments/:depId/rollback", description: "Rollback deployment" },
    ],
  },
  {
    tag: "Analytics",
    color: "text-secondary",
    bg: "bg-secondary/10 border-secondary/20",
    endpoints: [
      { method: "GET", path: "/api/sites/:id/analytics", description: "Per-site analytics" },
      { method: "GET", path: "/api/admin/analytics",     description: "Network-wide analytics" },
    ],
  },
  {
    tag: "Federation",
    color: "text-amber-400",
    bg: "bg-amber-400/10 border-amber-400/20",
    endpoints: [
      { method: "GET",  path: "/.well-known/federation",          description: "Node discovery" },
      { method: "GET",  path: "/api/federation/meta",             description: "Node metadata" },
      { method: "POST", path: "/api/federation/handshake",        description: "Initiate handshake" },
      { method: "POST", path: "/api/federation/ping",             description: "Signed ping" },
      { method: "POST", path: "/api/federation/sync",             description: "Receive site sync" },
      { method: "GET",  path: "/api/federation/manifest/:domain", description: "File manifest for replication" },
      { method: "GET",  path: "/api/federation/peers",            description: "List peers" },
      { method: "GET",  path: "/api/federation/events",           description: "Event log" },
      { method: "GET",  path: "/api/federation/gossip",           description: "Peer gossip list" },
      { method: "POST", path: "/api/federation/gossip/push",      description: "Receive gossip peers" },
      { method: "GET",  path: "/api/federation/bootstrap",        description: "Bootstrap peer registry" },
    ],
  },
  {
    tag: "Access & Tokens",
    color: "text-purple-400",
    bg: "bg-purple-400/10 border-purple-400/20",
    endpoints: [
      { method: "GET",    path: "/api/tokens",                       description: "List API tokens" },
      { method: "POST",   path: "/api/tokens",                       description: "Create API token" },
      { method: "DELETE", path: "/api/tokens/:id",                   description: "Revoke token" },
      { method: "GET",    path: "/api/sites/:id/members",            description: "List site members" },
      { method: "POST",   path: "/api/sites/:id/members",            description: "Add member" },
      { method: "PATCH",  path: "/api/sites/:id/visibility",         description: "Set site visibility" },
      { method: "GET",    path: "/api/sites/:id/domains",            description: "List custom domains" },
      { method: "POST",   path: "/api/sites/:id/domains",            description: "Add custom domain" },
      { method: "POST",   path: "/api/domains/:id/verify",           description: "Verify domain DNS" },
      { method: "POST",   path: "/api/domains/:id/provision-tls",    description: "Provision TLS cert" },
    ],
  },
  {
    tag: "Admin",
    color: "text-red-400",
    bg: "bg-red-400/10 border-red-400/20",
    endpoints: [
      { method: "GET",   path: "/api/admin/overview", description: "Operator dashboard data" },
      { method: "PATCH", path: "/api/admin/node",     description: "Update node settings" },
      { method: "GET",   path: "/api/admin/users",    description: "List all users" },
      { method: "GET",   path: "/api/admin/sites",    description: "List all sites" },
      { method: "GET",   path: "/api/webhooks/config", description: "Webhook configuration" },
      { method: "POST",  path: "/api/webhooks/test",   description: "Send test webhook" },
    ],
  },
] as const;

const METHOD_COLORS: Record<string, string> = {
  GET:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  POST:   "bg-primary/15 text-primary border-primary/20",
  PATCH:  "bg-amber-400/15 text-amber-400 border-amber-400/20",
  PUT:    "bg-orange-400/15 text-orange-400 border-orange-400/20",
  DELETE: "bg-red-500/15 text-red-400 border-red-500/20",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-muted-foreground hover:text-white transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-status-active" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function ApiDocs() {
  const [activeTag, setActiveTag] = useState("Sites");
  const specUrl = `${window.location.origin}${BASE}/api-spec`;

  return (
    <div className="space-y-8 pb-16 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4 justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">API Reference</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            Nexus Hosting REST API — v0.7.0 · OpenAPI 3.1
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`${BASE}/api-spec`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white gap-1.5">
              <FileCode className="w-4 h-4" />
              OpenAPI JSON
            </Button>
          </a>
          <a href="https://github.com/The-No-Hands-company/Nexus-Hosting/blob/main/docs/API.md" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white gap-1.5">
              <BookOpen className="w-4 h-4" />
              Full Docs
            </Button>
          </a>
        </div>
      </div>

      {/* Auth info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-muted/20 border border-white/5 rounded-2xl p-5">
          <p className="text-white font-semibold text-sm mb-2">Browser / Session Auth</p>
          <p className="text-muted-foreground text-xs mb-3">
            After signing in via <code className="text-primary">/api/login</code>, all requests from the browser automatically include the session cookie.
          </p>
          <div className="bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-muted-foreground">
            Cookie: sid=&lt;session-id&gt;
          </div>
        </div>
        <div className="bg-muted/20 border border-white/5 rounded-2xl p-5">
          <p className="text-white font-semibold text-sm mb-2">API Token Auth (CLI / CI)</p>
          <p className="text-muted-foreground text-xs mb-3">
            Create a token via the Tokens page or <code className="text-primary">POST /api/tokens</code>.
            Send it as a Bearer header on every request.
          </p>
          <div className="bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-primary flex items-center justify-between gap-2">
            <span>Authorization: Bearer fh_your_token</span>
            <CopyButton text="Authorization: Bearer fh_your_token" />
          </div>
        </div>
      </div>

      {/* Quick reference */}
      <div className="space-y-4">
        <div>
          <h2 className="text-white font-semibold text-lg mb-1">Quick Reference</h2>
          <p className="text-muted-foreground text-sm">All endpoints. Base URL: <code className="text-primary font-mono">{window.location.origin}</code></p>
        </div>

        {/* Tag filter */}
        <div className="flex flex-wrap gap-2">
          {ENDPOINT_GROUPS.map((g) => (
            <button
              key={g.tag}
              onClick={() => setActiveTag(g.tag)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                activeTag === g.tag ? `${g.bg} ${g.color}` : "border-white/5 text-muted-foreground hover:text-white hover:border-white/10"
              }`}
            >
              {g.tag}
            </button>
          ))}
        </div>

        {/* Endpoint table */}
        {ENDPOINT_GROUPS.filter((g) => g.tag === activeTag).map((group) => (
          <motion.div
            key={group.tag}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-white/5 rounded-2xl overflow-hidden"
          >
            <div className={`px-4 py-2.5 border-b border-white/5 flex items-center gap-2 ${group.bg}`}>
              <span className={`text-xs font-semibold ${group.color}`}>{group.tag}</span>
              <span className="text-muted-foreground text-xs">{group.endpoints.length} endpoints</span>
            </div>
            <div className="divide-y divide-white/5">
              {group.endpoints.map((ep) => (
                <div key={`${ep.method}:${ep.path}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/2 group">
                  <span className={`text-[11px] font-bold border rounded px-1.5 py-0.5 shrink-0 font-mono ${METHOD_COLORS[ep.method] ?? ""}`}>
                    {ep.method}
                  </span>
                  <code className="font-mono text-xs text-primary flex-1 truncate">{ep.path}</code>
                  <span className="text-muted-foreground text-xs hidden sm:block flex-shrink-0">{ep.description}</span>
                  <CopyButton text={`${window.location.origin}${ep.path}`} />
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Code examples */}
      <div className="space-y-4">
        <h2 className="text-white font-semibold text-lg">Code Examples</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[
            {
              title: "Deploy a site (CLI)",
              lang: "bash",
              code: `# Install the CLI
npm install -g @nexushosting/cli

# Authenticate
nh login --node https://your-node.example.com

# Deploy your built site
nh deploy ./dist --site 42`,
            },
            {
              title: "Deploy via API (fetch)",
              lang: "javascript",
              code: `// 1. Get presigned upload URL
const { uploadUrl, objectPath } = await fetch(
  '/api/sites/42/files/upload-url',
  { method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: 'index.html',
      contentType: 'text/html', size: file.size }) }
).then(r => r.json());

// 2. Upload directly to object storage
await fetch(uploadUrl, { method: 'PUT',
  headers: { 'Content-Type': 'text/html' }, body: file });

// 3. Register the file
await fetch('/api/sites/42/files', { method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ filePath: 'index.html',
    objectPath, contentType: 'text/html',
    sizeBytes: file.size }) });

// 4. Deploy
await fetch('/api/sites/42/deploy',
  { method: 'POST', credentials: 'include' });`,
            },
            {
              title: "Federation handshake",
              lang: "bash",
              code: `# Initiate a handshake with a remote node
curl -X POST https://your-node.example.com/api/federation/handshake \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer fh_your_token" \\
  -d '{"targetNodeUrl": "https://remote-node.example.com"}'`,
            },
            {
              title: "Verify a custom domain",
              lang: "bash",
              code: `# 1. Add the domain
curl -X POST /api/sites/42/domains \\
  -d '{"domain":"mysite.example.com"}'
# Returns verificationToken: fhv_abc123...

# 2. Add TXT record at _fh-verify.mysite.example.com
#    with value: fhv_abc123...

# 3. Trigger verification
curl -X POST /api/domains/7/verify`,
            },
          ].map((ex) => (
            <div key={ex.title} className="bg-muted/20 border border-white/5 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                <span className="text-white text-xs font-semibold">{ex.title}</span>
                <CopyButton text={ex.code} />
              </div>
              <pre className="px-4 py-3 text-xs text-primary/80 font-mono overflow-x-auto leading-relaxed">
                <code>{ex.code}</code>
              </pre>
            </div>
          ))}
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-3 pt-2 border-t border-white/5">
        <a href="https://github.com/The-No-Hands-company/Nexus-Hosting/blob/main/FEDERATION.md" target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Federation Protocol Spec
          </Button>
        </a>
        <a href="https://github.com/The-No-Hands-company/Nexus-Hosting/blob/main/docs/SELF_HOSTING.md" target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Self-Hosting Guide
          </Button>
        </a>
        <a href="https://github.com/The-No-Hands-company/Nexus-Hosting" target="_blank" rel="noopener noreferrer">
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> GitHub Repository
          </Button>
        </a>
      </div>
    </div>
  );
}
