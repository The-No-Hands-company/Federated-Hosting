import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LoadingState, ErrorState } from "@/components/shared";
import {
  Server, Globe, Radio, HardDrive, Activity, ExternalLink,
  Search, MapPin, CheckCircle, Clock, Wifi, WifiOff, Copy, Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BootstrapNode {
  domain: string;
  name: string;
  region: string;
  publicKey: string | null;
  verifiedAt: string;
}

interface BootstrapResponse {
  protocol: string;
  nodeCount: number;
  nodes: BootstrapNode[];
  generatedAt: string;
}

interface NodeWithCapacity {
  id: number;
  name: string;
  domain: string;
  region: string;
  status: string;
  storageCapacityGb: number;
  siteCount: number;
  uptimePercent: number;
  verifiedAt: string | null;
  lastSeenAt: string | null;
  joinedAt: string;
}

interface NodeListResponse {
  data: NodeWithCapacity[];
  meta: { total: number; page: number; limit: number };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-muted-foreground hover:text-white transition-colors p-1"
      title="Copy domain"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-status-active" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function NodeCard({ node, index }: { node: NodeWithCapacity; index: number }) {
  const isActive = node.status === "active";
  const isVerified = Boolean(node.verifiedAt);
  const storageUsedPct = 0; // would need per-node capacity endpoint

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className={cn(
        "border transition-colors hover:border-white/15 group",
        isActive ? "border-white/8" : "border-white/4 opacity-70",
      )}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "w-9 h-9 rounded-xl border flex items-center justify-center shrink-0",
                isActive ? "bg-primary/10 border-primary/20" : "bg-muted/20 border-white/5",
              )}>
                <Server className={cn("w-4 h-4", isActive ? "text-primary" : "text-muted-foreground")} />
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{node.name}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  <p className="text-muted-foreground text-xs font-mono truncate">{node.domain}</p>
                  <CopyButton text={node.domain} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isActive ? (
                <Badge variant="outline" className="border-status-active/30 text-status-active text-xs gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-active animate-pulse" />
                  Online
                </Badge>
              ) : (
                <Badge variant="outline" className="border-white/10 text-muted-foreground text-xs gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                  Offline
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{node.region}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Globe className="w-3.5 h-3.5 shrink-0" />
              <span>{node.siteCount} sites</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              <span>{node.storageCapacityGb} GB</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="w-3.5 h-3.5 shrink-0" />
              <span>{node.uptimePercent.toFixed(1)}% uptime</span>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-white/5 pt-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isVerified ? (
                <><CheckCircle className="w-3.5 h-3.5 text-status-active" />
                  <span>Verified {formatDistanceToNow(new Date(node.verifiedAt!), { addSuffix: true })}</span></>
              ) : (
                <><Clock className="w-3.5 h-3.5" />
                  <span>Joined {formatDistanceToNow(new Date(node.joinedAt), { addSuffix: true })}</span></>
              )}
            </div>
            <a
              href={`https://${node.domain}/.well-known/federation`}
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-white">
                <ExternalLink className="w-3 h-3 mr-1" />
                Inspect
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function Marketplace() {
  const [search, setSearch] = useState("");

  const { data: nodeData, isLoading, error } = useQuery<NodeListResponse>({
    queryKey: ["nodes", "marketplace"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/nodes?limit=100`);
      if (!r.ok) throw new Error("Failed to load nodes");
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const { data: bootstrap } = useQuery<BootstrapResponse>({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/federation/bootstrap`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 300_000,
  });

  const nodes = nodeData?.data ?? [];
  const filtered = nodes.filter(
    (n) =>
      !search ||
      n.name.toLowerCase().includes(search.toLowerCase()) ||
      n.domain.toLowerCase().includes(search.toLowerCase()) ||
      n.region.toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = nodes.filter((n) => n.status === "active").length;
  const verifiedCount = nodes.filter((n) => n.verifiedAt).length;

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Node Network</h1>
        <p className="text-muted-foreground mt-1 font-mono text-sm">
          Browse federation nodes — connect to any of them to join the network
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Nodes",     value: nodes.length,   icon: Server,       color: "text-primary",       bg: "bg-primary/10 border-primary/20" },
          { label: "Online Now",      value: activeCount,    icon: Wifi,         color: "text-status-active", bg: "bg-status-active/10 border-status-active/20" },
          { label: "Verified",        value: verifiedCount,  icon: CheckCircle,  color: "text-secondary",     bg: "bg-secondary/10 border-secondary/20" },
          { label: "Bootstrap Nodes", value: bootstrap?.nodeCount ?? 0, icon: Radio, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
        ].map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div key={c.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card className={`border ${c.bg}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${c.color}`} />
                    <span className="text-muted-foreground text-xs">{c.label}</span>
                  </div>
                  <p className={`text-2xl font-bold font-mono ${c.color}`}>{c.value}</p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* Bootstrap info box */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5 flex items-start gap-4">
          <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm mb-1">Joining the federation</p>
            <p className="text-muted-foreground text-xs mb-3">
              To connect your node to the network, initiate a handshake from your{" "}
              <a href="/federation" className="text-primary hover:underline">Federation Protocol</a> page,
              or use this bootstrap endpoint in your node config:
            </p>
            <div className="bg-black/40 rounded-lg px-3 py-2 font-mono text-xs text-primary flex items-center justify-between gap-2">
              <span className="truncate">{window.location.origin}/api/federation/bootstrap</span>
              <button
                onClick={() => navigator.clipboard.writeText(`${window.location.origin}/api/federation/bootstrap`)}
                className="text-muted-foreground hover:text-white transition-colors shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Search by name, domain or region…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-muted/20 border border-white/8 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 text-sm"
        />
      </div>

      {/* Node grid */}
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load network nodes." />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <WifiOff className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-muted-foreground">{search ? "No nodes match your search." : "No nodes in the network yet."}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((node, i) => (
              <NodeCard key={node.id} node={node} index={i} />
            ))}
          </div>
          <p className="text-center text-muted-foreground text-xs">
            Showing {filtered.length} of {nodes.length} nodes · Refreshes every 2 minutes
          </p>
        </>
      )}
    </div>
  );
}
