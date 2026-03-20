import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { LoadingState, ErrorState } from "@/components/shared";
import { useAuth } from "@workspace/auth-web";
import {
  Settings, Globe, Lock, Eye, EyeOff, ArrowRight, Plus, Trash2,
  AlertTriangle, Save, ChevronLeft, Shield, KeyRound, Eye as EyeIcon, EyeOff as EyeOffIcon,
} from "lucide-react";

interface EnvVar { id: number; key: string; value: string; secret: number; }

function EnvVarsPanel({ siteId }: { siteId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newKey, setNewKey]     = useState("");
  const [newVal, setNewVal]     = useState("");
  const [isSecret, setIsSecret] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const { data: vars = [] } = useQuery<EnvVar[]>({
    queryKey: ["env-vars", siteId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/env`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/env`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newKey.toUpperCase(), value: newVal, secret: isSecret ? 1 : 0 }),
      });
      if (!r.ok) throw new Error((await r.json() as any).message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["env-vars", siteId] });
      setNewKey(""); setNewVal(""); setIsSecret(false);
      toast({ title: "Env var set" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      await fetch(`${BASE}/api/sites/${siteId}/env/${encodeURIComponent(key)}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["env-vars", siteId] }),
  });

  return (
    <Card className="border-white/5">
      <CardHeader>
        <CardTitle className="text-white text-base flex items-center gap-2"><KeyRound className="w-4 h-4" />Build Environment Variables</CardTitle>
        <CardDescription>Injected into the build pipeline. Secret vars are masked in logs and API responses.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {vars.map(v => (
          <div key={v.id} className="flex items-center gap-2 p-3 bg-muted/10 rounded-lg border border-white/5 text-sm font-mono">
            <span className="text-primary w-40 truncate shrink-0">{v.key}</span>
            <span className="flex-1 text-muted-foreground truncate">
              {v.secret && !revealed.has(v.id) ? "***" : v.value}
            </span>
            {v.secret && (
              <button className="text-muted-foreground hover:text-white" onClick={() =>
                setRevealed(s => { const n = new Set(s); n.has(v.id) ? n.delete(v.id) : n.add(v.id); return n; })}>
                {revealed.has(v.id) ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
              </button>
            )}
            <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-400 shrink-0"
              onClick={() => deleteMutation.mutate(v.key)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        {vars.length === 0 && <p className="text-muted-foreground text-sm py-1">No env vars set yet.</p>}

        <div className="pt-3 border-t border-white/5 space-y-2">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Add variable</p>
          <div className="flex gap-2">
            <Input placeholder="KEY_NAME" value={newKey}
              onChange={e => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
              className="bg-muted/20 border-white/8 font-mono text-xs w-40" />
            <Input placeholder="value" value={newVal} onChange={e => setNewVal(e.target.value)}
              type={isSecret ? "password" : "text"}
              className="bg-muted/20 border-white/8 font-mono text-xs flex-1" />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={isSecret} onChange={e => setIsSecret(e.target.checked)} className="rounded" />
              Secret (mask value)
            </label>
            <Button onClick={() => addMutation.mutate()} disabled={!newKey || !newVal || addMutation.isPending} className="gap-1.5 ml-auto">
              <Plus className="w-4 h-4" />Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Site {
  id: number; name: string; domain: string; visibility: string;
}

interface RedirectRule {
  id: number; src: string; dest: string; status: number; force: number; position: number;
}

interface CustomHeader {
  id: number; path: string; name: string; value: string;
}

const VISIBILITY_OPTIONS = [
  { value: "public",   label: "Public",   icon: Globe,   desc: "Anyone can view this site" },
  { value: "private",  label: "Private",  icon: EyeOff,  desc: "Only you can view this site" },
  { value: "password", label: "Password", icon: Lock,    desc: "Visitors must enter a password" },
];

const REDIRECT_STATUS_OPTIONS = [
  { value: 301, label: "301 Permanent" },
  { value: 302, label: "302 Temporary" },
  { value: 200, label: "200 Rewrite" },
  { value: 404, label: "404 Not Found" },
  { value: 410, label: "410 Gone" },
];

export default function SiteSettings() {
  const { id } = useParams<{ id: string }>();
  const siteId = parseInt(id!, 10);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isAuthenticated } = useAuth();

  const [password, setPassword]           = useState("");
  const [unlockMessage, setUnlockMessage] = useState("");
  const [newRedirect, setNewRedirect] = useState({ src: "", dest: "", status: 301 });
  const [newHeader, setNewHeader] = useState({ path: "/*", name: "", value: "" });

  const { data: site, isLoading } = useQuery<Site>({
    queryKey: ["site", siteId],
    queryFn: async () => { const r = await fetch(`${BASE}/api/sites/${siteId}`, { credentials: "include" }); if (!r.ok) throw new Error("Failed"); return r.json(); },
    enabled: isAuthenticated,
  });

  const { data: redirects = [] } = useQuery<RedirectRule[]>({
    queryKey: ["redirects", siteId],
    queryFn: async () => { const r = await fetch(`${BASE}/api/sites/${siteId}/redirects`, { credentials: "include" }); if (!r.ok) return []; return r.json(); },
    enabled: isAuthenticated,
  });

  const { data: headers = [] } = useQuery<CustomHeader[]>({
    queryKey: ["custom-headers", siteId],
    queryFn: async () => { const r = await fetch(`${BASE}/api/sites/${siteId}/headers`, { credentials: "include" }); if (!r.ok) return []; return r.json(); },
    enabled: isAuthenticated,
  });

  const visibilityMutation = useMutation({
    mutationFn: async ({ visibility, password }: { visibility: string; password?: string }) => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/visibility`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility, ...(password ? { password } : {}), ...(unlockMessage ? { unlockMessage } : {}) }),
      });
      if (!r.ok) { const e = await r.json() as any; throw new Error(e.message ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["site", siteId] }); toast({ title: "Visibility updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addRedirectMutation = useMutation({
    mutationFn: async (rule: { src: string; dest: string; status: number }) => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/redirects`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(rule),
      });
      if (!r.ok) { const e = await r.json() as any; throw new Error(e.message ?? "Failed"); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["redirects", siteId] }); setNewRedirect({ src: "", dest: "", status: 301 }); toast({ title: "Redirect rule added" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteRedirectMutation = useMutation({
    mutationFn: async (ruleId: number) => {
      await fetch(`${BASE}/api/sites/${siteId}/redirects/${ruleId}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["redirects", siteId] }),
  });

  const addHeaderMutation = useMutation({
    mutationFn: async (h: { path: string; name: string; value: string }) => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/headers`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(h),
      });
      if (!r.ok) { const e = await r.json() as any; throw new Error(e.message ?? "Failed"); }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["custom-headers", siteId] }); setNewHeader({ path: "/*", name: "", value: "" }); toast({ title: "Header rule added" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteHeaderMutation = useMutation({
    mutationFn: async (headerId: number) => {
      await fetch(`${BASE}/api/sites/${siteId}/headers/${headerId}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-headers", siteId] }),
  });

  const deleteSiteMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) { const e = await r.json() as any; throw new Error(e.message ?? "Failed"); }
    },
    onSuccess: () => { toast({ title: "Site deleted" }); navigate("/my-sites"); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!isAuthenticated) return <div className="p-8 text-muted-foreground">Sign in to manage site settings.</div>;
  if (isLoading) return <LoadingState />;
  if (!site) return <ErrorState message="Site not found." />;

  return (
    <div className="space-y-6 pb-12 max-w-3xl animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/my-sites")} className="text-muted-foreground hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-white">Site Settings</h1>
          <p className="text-muted-foreground text-sm font-mono">{site.domain}</p>
        </div>
      </div>

      <Tabs defaultValue="visibility">
        <TabsList className="bg-muted/30 border border-white/5">
          <TabsTrigger value="visibility">Visibility</TabsTrigger>
          <TabsTrigger value="redirects">Redirects</TabsTrigger>
          <TabsTrigger value="headers">Headers</TabsTrigger>
          <TabsTrigger value="env">Env Vars</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="danger" className="text-red-400 data-[state=active]:text-red-300">Danger</TabsTrigger>
        </TabsList>

        {/* ── Visibility ── */}
        <TabsContent value="visibility" className="space-y-4 mt-4">
          <Card className="border-white/5">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2"><Eye className="w-4 h-4" />Site Visibility</CardTitle>
              <CardDescription>Control who can access this site.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {VISIBILITY_OPTIONS.map(opt => {
                const Icon = opt.icon;
                const isActive = site.visibility === opt.value;
                return (
                  <button key={opt.value} onClick={() => opt.value !== "password" && visibilityMutation.mutate({ visibility: opt.value })}
                    className={cn("w-full text-left p-4 rounded-xl border transition-all flex items-center gap-4",
                      isActive ? "border-primary/40 bg-primary/5" : "border-white/5 hover:border-white/15")}>
                    <div className={cn("w-9 h-9 rounded-lg border flex items-center justify-center shrink-0",
                      isActive ? "bg-primary/15 border-primary/25" : "bg-muted/20 border-white/5")}>
                      <Icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn("font-semibold text-sm", isActive ? "text-white" : "text-muted-foreground")}>{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                    {isActive && <Badge variant="outline" className="border-primary/30 text-primary text-xs">Active</Badge>}
                  </button>
                );
              })}

              {/* Password input when selecting password visibility */}
              <div className="pt-2 space-y-2 border-t border-white/5">
                <Label className="text-sm text-muted-foreground">Set password (required for password protection)</Label>
                <div className="flex gap-2">
                  <Input type="password" placeholder="New password…" value={password} onChange={e => setPassword(e.target.value)}
                    className="bg-muted/20 border-white/8 focus:border-primary/40" />
                  <Button onClick={() => { visibilityMutation.mutate({ visibility: "password", password }); setPassword(""); }}
                    disabled={!password || visibilityMutation.isPending}
                    className="shrink-0">
                    <Lock className="w-4 h-4 mr-1.5" />Set
                  </Button>
                </div>
                <Label className="text-sm text-muted-foreground mt-2 block">Custom message on password gate (optional)</Label>
                <div className="flex gap-2">
                  <Input placeholder="This site is members only…" value={unlockMessage}
                    onChange={e => setUnlockMessage(e.target.value)} maxLength={200}
                    className="bg-muted/20 border-white/8 focus:border-primary/40" />
                  <Button variant="outline" onClick={() => visibilityMutation.mutate({ visibility: "password" })}
                    disabled={visibilityMutation.isPending}
                    className="shrink-0 border-white/10">
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Redirects ── */}
        <TabsContent value="redirects" className="space-y-4 mt-4">
          <Card className="border-white/5">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2"><ArrowRight className="w-4 h-4" />Redirect Rules</CardTitle>
              <CardDescription>Redirect or rewrite URLs. Rules are processed in order — first match wins.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {redirects.map(rule => (
                <div key={rule.id} className="flex items-center gap-2 p-3 bg-muted/10 rounded-lg border border-white/5 text-sm font-mono">
                  <span className="text-primary flex-1 truncate">{rule.src}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground flex-1 truncate">{rule.dest}</span>
                  <Badge variant="outline" className="border-white/10 text-xs shrink-0">{rule.status}</Badge>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-400 shrink-0"
                    onClick={() => deleteRedirectMutation.mutate(rule.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}

              {redirects.length === 0 && <p className="text-muted-foreground text-sm py-2">No redirect rules yet.</p>}

              <div className="pt-3 border-t border-white/5 space-y-2">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Add rule</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Source /old-path" value={newRedirect.src} onChange={e => setNewRedirect(r => ({ ...r, src: e.target.value }))} className="bg-muted/20 border-white/8 font-mono text-xs" />
                  <Input placeholder="Destination /new-path" value={newRedirect.dest} onChange={e => setNewRedirect(r => ({ ...r, dest: e.target.value }))} className="bg-muted/20 border-white/8 font-mono text-xs" />
                </div>
                <div className="flex gap-2">
                  <select value={newRedirect.status} onChange={e => setNewRedirect(r => ({ ...r, status: parseInt(e.target.value) }))}
                    className="flex-1 bg-muted/20 border border-white/8 rounded-lg px-3 py-2 text-sm text-white">
                    {REDIRECT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <Button onClick={() => addRedirectMutation.mutate(newRedirect)} disabled={!newRedirect.src || !newRedirect.dest || addRedirectMutation.isPending} className="gap-1.5">
                    <Plus className="w-4 h-4" />Add
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Custom Headers ── */}
        <TabsContent value="headers" className="space-y-4 mt-4">
          <Card className="border-white/5">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2"><Shield className="w-4 h-4" />Custom Response Headers</CardTitle>
              <CardDescription>Add security headers, CORS rules, or custom metadata to responses.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {headers.map(h => (
                <div key={h.id} className="flex items-center gap-2 p-3 bg-muted/10 rounded-lg border border-white/5 text-xs font-mono">
                  <span className="text-muted-foreground shrink-0">{h.path}</span>
                  <span className="text-primary flex-1 truncate">{h.name}</span>
                  <span className="text-muted-foreground flex-1 truncate">{h.value}</span>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-400 shrink-0"
                    onClick={() => deleteHeaderMutation.mutate(h.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}

              {headers.length === 0 && <p className="text-muted-foreground text-sm py-2">No custom headers yet.</p>}

              <div className="pt-3 border-t border-white/5 space-y-2">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Add header</p>
                <Input placeholder="Path pattern (e.g. /*)" value={newHeader.path} onChange={e => setNewHeader(h => ({ ...h, path: e.target.value }))} className="bg-muted/20 border-white/8 font-mono text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Header name" value={newHeader.name} onChange={e => setNewHeader(h => ({ ...h, name: e.target.value }))} className="bg-muted/20 border-white/8 font-mono text-xs" />
                  <Input placeholder="Header value" value={newHeader.value} onChange={e => setNewHeader(h => ({ ...h, value: e.target.value }))} className="bg-muted/20 border-white/8 font-mono text-xs" />
                </div>
                <Button onClick={() => addHeaderMutation.mutate(newHeader)} disabled={!newHeader.name || !newHeader.value || addHeaderMutation.isPending} className="gap-1.5">
                  <Plus className="w-4 h-4" />Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Webhooks ── */}
        <TabsContent value="webhooks" className="mt-4">
          <div className="rounded-xl border border-white/5 p-4 text-sm text-muted-foreground">
            <p>Manage webhooks in the dedicated Webhooks page.</p>
            <a href={`/sites/${siteId}/webhooks`} className="text-primary hover:underline mt-2 block">→ Open Webhooks Manager</a>
          </div>
        </TabsContent>

        {/* ── Env Vars ── */}
        <TabsContent value="env" className="space-y-4 mt-4">
          <EnvVarsPanel siteId={siteId} />
        </TabsContent>

        {/* ── Danger Zone ── */}
        <TabsContent value="danger" className="space-y-4 mt-4">
          <Card className="border-red-500/20 bg-red-500/5">
            <CardHeader>
              <CardTitle className="text-red-400 text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Danger Zone</CardTitle>
              <CardDescription>These actions cannot be undone.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4 p-4 border border-red-500/20 rounded-xl">
                <div>
                  <p className="text-white font-semibold text-sm">Delete this site</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Permanently delete {site.domain} and all its deployments.</p>
                </div>
                <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Delete ${site.domain}? This cannot be undone.`)) deleteSiteMutation.mutate(); }}
                  disabled={deleteSiteMutation.isPending} className="shrink-0">
                  {deleteSiteMutation.isPending ? "Deleting…" : "Delete Site"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
