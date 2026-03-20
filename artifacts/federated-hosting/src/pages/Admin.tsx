import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/replit-auth-web";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState, StatusBadge } from "@/components/shared";
import {
  Server, Users, Globe, Activity, HardDrive, Cpu, MemoryStick,
  TrendingUp, Settings, LogIn, RefreshCw, Zap, Radio,
} from "lucide-react";
import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/components/ui/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AdminOverview {
  node: {
    id: number; name: string; domain: string; region: string;
    status: string; publicKey: string; joinedAt: string;
    operatorEmail?: string; storageCapacityGb: number;
  };
  summary: {
    totalSites: number; activeSites: number; totalUsers: number;
    totalDeploys: number; totalNodes: number; activeNodes: number;
  };
  analytics24h: { hits: number; bytesServed: number };
  recentEvents: Array<{
    id: number; eventType: string; fromNodeDomain: string;
    toNodeDomain: string; verified: number; createdAt: string;
  }>;
  storageByOwner: Array<{ ownerId: string; totalMb: number; siteCount: number }>;
  systemInfo: {
    platform: string; arch: string; hostname: string;
    totalMemMb: number; freeMemMb: number; loadAvg: number[];
    uptimeSeconds: number; nodeVersion: string;
  };
}

interface NodeSettings {
  name: string; region: string; operatorEmail: string;
  maxStorageGb: number; description: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const EVENT_TYPE_STYLES: Record<string, string> = {
  handshake:   "bg-primary/10 text-primary border-primary/20",
  ping:        "bg-secondary/10 text-secondary border-secondary/20",
  site_sync:   "bg-status-active/10 text-status-active border-status-active/20",
  node_offline:"bg-red-500/10 text-red-400 border-red-500/20",
  key_rotation:"bg-amber-400/10 text-amber-400 border-amber-400/20",
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? `HTTP ${r.status}`);
  }
  return r.json();
}

export default function AdminPage() {
  const { isAuthenticated, login } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [nodeSettings, setNodeSettings] = useState<Partial<NodeSettings>>({});

  const { data, isLoading, error, refetch } = useQuery<AdminOverview>({
    queryKey: ["admin", "overview"],
    queryFn: () => apiFetch<AdminOverview>("/admin/overview"),
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const updateNodeMutation = useMutation({
    mutationFn: (body: Partial<NodeSettings>) =>
      apiFetch("/admin/node", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      setEditMode(false);
      toast({ title: "Node settings updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
          <Server className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">{t("admin.title")}</h2>
          <p className="text-muted-foreground">{t("errors.authRequiredMsg")}</p>
        </div>
        <Button onClick={login} className="bg-primary text-black hover:bg-primary/90 font-semibold">
          <LogIn className="w-4 h-4 mr-2" /> Sign In
        </Button>
      </div>
    );
  }

  if (isLoading) return <LoadingState />;
  if (error || !data) return <ErrorState message="Failed to load admin overview." />;

  const { node, summary, analytics24h, recentEvents, systemInfo } = data;
  const memUsedPct = Math.round((1 - systemInfo.freeMemMb / systemInfo.totalMemMb) * 100);
  const load = systemInfo.loadAvg[0]?.toFixed(2) ?? "0.00";

  const summaryCards = [
    { label: "Active Sites",   value: `${summary.activeSites} / ${summary.totalSites}`,   icon: Globe,    color: "text-primary",         bg: "bg-primary/10 border-primary/20" },
    { label: "Active Nodes",   value: `${summary.activeNodes} / ${summary.totalNodes}`,   icon: Server,   color: "text-secondary",       bg: "bg-secondary/10 border-secondary/20" },
    { label: "Users",          value: summary.totalUsers,                                  icon: Users,    color: "text-amber-400",       bg: "bg-amber-400/10 border-amber-400/20" },
    { label: "Deploys",        value: summary.totalDeploys,                               icon: Zap,      color: "text-status-active",   bg: "bg-status-active/10 border-status-active/20" },
    { label: "Hits (24h)",     value: analytics24h.hits.toLocaleString(),                 icon: TrendingUp,color: "text-primary",        bg: "bg-primary/10 border-primary/20" },
    { label: "Bandwidth (24h)",value: formatBytes(analytics24h.bytesServed),              icon: Activity, color: "text-secondary",       bg: "bg-secondary/10 border-secondary/20" },
  ];

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{t("admin.title")}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">{node.domain}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}
            className="border-white/10 text-muted-foreground hover:text-white">
            <RefreshCw className="w-4 h-4 mr-2" /> {t("common.refresh")}
          </Button>
          <Button size="sm" onClick={() => { setEditMode(!editMode); setNodeSettings({ name: node.name, region: node.region, operatorEmail: node.operatorEmail }); }}
            className={editMode ? "bg-muted border-white/10" : "bg-primary text-black hover:bg-primary/90 font-semibold"}>
            <Settings className="w-4 h-4 mr-2" />{editMode ? t("admin.editCancel") : t("admin.edit")}
          </Button>
        </div>
      </div>

      {/* Node settings edit panel */}
      {editMode && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-white text-lg">Node Settings</CardTitle>
              <CardDescription>Update your node's identity and operator information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { key: "name",          label: "Node Name",       placeholder: node.name },
                  { key: "region",        label: "Region",          placeholder: node.region },
                  { key: "operatorEmail", label: "Operator Email",  placeholder: node.operatorEmail ?? "" },
                  { key: "maxStorageGb",  label: "Max Storage (GB)",placeholder: String(node.storageCapacityGb), type: "number" },
                ].map(({ key, label, placeholder, type }) => (
                  <div key={key}>
                    <label className="text-sm text-muted-foreground mb-1.5 block">{label}</label>
                    <input
                      type={type ?? "text"}
                      placeholder={placeholder}
                      value={(nodeSettings as Record<string, string>)[key] ?? ""}
                      onChange={(e) => setNodeSettings(prev => ({ ...prev, [key]: type === "number" ? Number(e.target.value) : e.target.value }))}
                      className="w-full bg-muted/30 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" onClick={() => setEditMode(false)} className="border-white/10">Cancel</Button>
                <Button
                  onClick={() => updateNodeMutation.mutate(nodeSettings)}
                  disabled={updateNodeMutation.isPending}
                  className="bg-primary text-black hover:bg-primary/90 font-semibold"
                >
                  {updateNodeMutation.isPending ? t("admin.saving") : t("admin.saveChanges")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {summaryCards.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div key={c.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className={`border ${c.bg}`}>
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Icon className={`w-4 h-4 ${c.color}`} />
                    <span className="text-muted-foreground text-sm">{c.label}</span>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* System info + node identity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* System info */}
        <Card className="border-white/5">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Cpu className="w-5 h-5 text-muted-foreground" /> {t("admin.sections.system")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Platform",     value: `${systemInfo.platform} (${systemInfo.arch})` },
              { label: "Hostname",     value: systemInfo.hostname },
              { label: "Node.js",      value: systemInfo.nodeVersion },
              { label: "Uptime",       value: formatUptime(systemInfo.uptimeSeconds) },
              { label: "Load Avg",     value: load },
              { label: "Memory",       value: `${systemInfo.freeMemMb} MB free / ${systemInfo.totalMemMb} MB total` },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                <span className="text-muted-foreground text-sm">{label}</span>
                <span className="text-white text-sm font-mono">{value}</span>
              </div>
            ))}
            {/* Memory bar */}
            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>Memory usage</span>
                <span>{memUsedPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${memUsedPct > 85 ? "bg-red-400" : memUsedPct > 65 ? "bg-amber-400" : "bg-status-active"}`}
                  style={{ width: `${memUsedPct}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Node identity */}
        <Card className="border-white/5">
          <CardHeader>
            <CardTitle className="text-white text-lg flex items-center gap-2">
              <Radio className="w-5 h-5 text-muted-foreground" /> {t("admin.sections.nodeIdentity")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Name",    value: node.name },
              { label: "Domain",  value: node.domain },
              { label: "Region",  value: node.region },
              { label: "Status",  value: node.status },
              { label: "Joined",  value: formatDistanceToNow(new Date(node.joinedAt), { addSuffix: true }) },
              { label: "Storage", value: `${node.storageCapacityGb} GB capacity` },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                <span className="text-muted-foreground text-sm">{label}</span>
                {label === "Status"
                  ? <StatusBadge status={value} />
                  : <span className="text-white text-sm font-mono truncate max-w-[200px]">{value}</span>
                }
              </div>
            ))}
            {node.publicKey && (
              <div className="pt-1">
                <p className="text-muted-foreground text-xs mb-1">Public Key (Ed25519)</p>
                <code className="font-mono text-xs text-primary/70 break-all leading-relaxed block bg-muted/20 rounded-lg p-2">
                  {node.publicKey.slice(0, 64)}…
                </code>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent federation events */}
      <Card className="border-white/5">
        <CardHeader>
          <CardTitle className="text-white text-lg">{t("admin.sections.recentEvents")}</CardTitle>
          <CardDescription>{t("admin.sections.recentEventsSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("admin.noEvents")}</p>
          ) : (
            <div className="space-y-2">
              {recentEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-xs font-mono ${EVENT_TYPE_STYLES[ev.eventType] ?? "border-white/10 text-muted-foreground"}`}
                  >
                    {ev.eventType}
                  </Badge>
                  <span className="text-muted-foreground text-sm truncate flex-1">
                    {ev.fromNodeDomain} → {ev.toNodeDomain}
                  </span>
                  <span className="text-muted-foreground text-xs shrink-0">
                    {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
