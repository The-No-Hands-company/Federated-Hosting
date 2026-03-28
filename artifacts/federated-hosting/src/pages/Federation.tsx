import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Shield, Key, Radio, Activity, Loader2, CheckCircle, XCircle,
  Globe, AlertTriangle, Server, Clock, RefreshCw, Wifi, WifiOff,
  ChevronDown, ChevronUp, Ban, Trash2, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FederationMeta {
  protocol: string;
  name: string;
  domain: string;
  region: string;
  publicKey: string | null;
  nodeCount: number;
  activeSites: number;
  joinedAt: string;
  capabilities: string[];
}

interface Peer {
  id: number;
  name: string;
  domain: string;
  region: string;
  status: string;
  lastSeenAt: string | null;
  verifiedAt: string | null;
  publicKey: string | null;
  siteCount: number;
  uptimePercent: number;
  trustLevel?: string | null;
}

interface FedEvent {
  id: number;
  eventType: string;
  fromNodeDomain: string;
  toNodeDomain: string | null;
  verified: number;
  createdAt: string;
  payload?: string | null;
}

const EVENT_COLORS: Record<string, string> = {
  handshake: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  ping: "bg-primary/10 text-primary border-primary/30",
  site_sync: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  node_offline: "bg-red-500/10 text-red-400 border-red-500/30",
  key_rotation: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
};

const STATUS_CONFIG: Record<string, { label: string; className: string; Icon: typeof Wifi }> = {
  active: { label: "Online", className: "text-status-active border-status-active/30 bg-status-active/10", Icon: Wifi },
  inactive: { label: "Offline", className: "text-status-inactive border-status-inactive/30 bg-status-inactive/10", Icon: WifiOff },
  maintenance: { label: "Maintenance", className: "text-status-maintenance border-status-maintenance/30 bg-status-maintenance/10", Icon: AlertTriangle },
};

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-status-active animate-pulse",
    inactive: "bg-status-inactive",
    maintenance: "bg-status-maintenance",
  };
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status] ?? "bg-muted-foreground"}`} />;
}

// ── Blocklist card ────────────────────────────────────────────────────────────

interface BlockEntry { id: number; nodeDomain: string; reason: string | null; createdAt: string; }

function BlocklistCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery<{ blocks: BlockEntry[]; total: number }>({
    queryKey: ["federation-blocks"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/federation/blocks`, { credentials: "include" });
      if (r.status === 403) return { blocks: [], total: 0 }; // not admin
      return r.ok ? r.json() : { blocks: [], total: 0 };
    },
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/federation/blocks`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeDomain: domain.trim(), reason: reason.trim() || undefined }),
      });
      if (!r.ok) { const b = await r.json() as { message?: string }; throw new Error(b.message ?? "Failed"); }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["federation-blocks"] });
      setDomain(""); setReason("");
      toast({ title: "Node blocked", description: `${domain.trim()} can no longer federate with this node.` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (d: string) => {
      const r = await fetch(`${BASE}/api/federation/blocks/${encodeURIComponent(d)}`, {
        method: "DELETE", credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to unblock");
    },
    onSuccess: (_, d) => {
      qc.invalidateQueries({ queryKey: ["federation-blocks"] });
      toast({ title: "Node unblocked", description: `${d} can federate again.` });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const blocks = data?.blocks ?? [];

  return (
    <Card className="glass-panel border-red-500/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-white flex items-center gap-2">
          <Ban className="w-4 h-4 text-red-400" />
          Defederation Blocklist
        </CardTitle>
        <CardDescription>
          Blocked nodes cannot handshake, sync, or appear in bootstrap. They are not notified.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add block form */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="node.example.com"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            className="bg-muted/20 border-white/8 font-mono text-sm flex-1"
          />
          <Input
            placeholder="Reason (optional)"
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="bg-muted/20 border-white/8 text-sm flex-1"
          />
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!domain.trim() || addMutation.isPending}
            className="bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 shrink-0"
            variant="outline"
          >
            {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Ban className="w-4 h-4 mr-1.5" />Block</>}
          </Button>
        </div>

        {/* Block list */}
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" />Loading blocklist…
          </div>
        ) : blocks.length === 0 ? (
          <p className="text-muted-foreground text-sm py-2">
            No nodes blocked. The federation is open.
          </p>
        ) : (
          <div className="space-y-1.5">
            {blocks.map(b => (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2"
              >
                <Ban className="w-3.5 h-3.5 text-red-400 shrink-0" />
                <span className="font-mono text-sm text-white/80 flex-1 truncate">{b.nodeDomain}</span>
                {b.reason && <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[200px]">{b.reason}</span>}
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="w-7 h-7 text-muted-foreground hover:text-red-400 shrink-0"
                  onClick={() => removeMutation.mutate(b.nodeDomain)}
                  title="Unblock"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </motion.div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Federation() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetUrl, setTargetUrl] = useState("https://");
  const [handshaking, setHandshaking] = useState(false);
  const [handshakeResult, setHandshakeResult] = useState<{ success: boolean; error?: string; discoveryData?: FederationMeta } | null>(null);
  const [showProtocolRef, setShowProtocolRef] = useState(false);

  const { data: localMeta, isLoading: loadingLocal, refetch: refetchLocal } = useQuery<FederationMeta>({
    queryKey: ["federation", "local"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/federation/meta`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: peers, isLoading: loadingPeers, dataUpdatedAt: peersUpdatedAt, refetch: refetchPeers } = useQuery<Peer[]>({
    queryKey: ["federation", "peers"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/federation/peers?limit=50`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load peers");
      const json = await res.json();
      return (json.data ?? json) as Peer[];
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: events, isLoading: loadingEvents, dataUpdatedAt: eventsUpdatedAt, refetch: refetchEvents } = useQuery<FedEvent[]>({
    queryKey: ["federation", "events"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/federation/events?limit=50`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load events");
      const json = await res.json();
      return (json.data ?? json) as FedEvent[];
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const doHandshake = async () => {
    if (!targetUrl || targetUrl === "https://") return;
    setHandshaking(true);
    setHandshakeResult(null);
    try {
      const res = await fetch(`${BASE}/api/federation/handshake`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ targetNodeUrl: targetUrl }),
      });
      const data = await res.json();
      setHandshakeResult(data);
      queryClient.invalidateQueries({ queryKey: ["federation"] });
      if (data.success) {
        toast({ title: "Handshake verified!", description: `Now federated with ${data.discoveryData?.name ?? targetUrl}` });
        setTargetUrl("https://");
      } else {
        toast({ title: "Handshake failed", description: data.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Connection error", description: err.message, variant: "destructive" });
    } finally {
      setHandshaking(false);
    }
  };

  const onlineCount = peers?.filter((p) => p.status === "active").length ?? 0;
  const totalPeers = peers?.length ?? 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Federation Protocol</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            Ed25519-verified mesh network — {onlineCount}/{totalPeers} peers online
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-white/10 text-muted-foreground hover:text-white w-fit"
          onClick={() => { refetchLocal(); refetchPeers(); refetchEvents(); }}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Refresh All
        </Button>
      </div>

      {/* Top Row — Identity + Handshake */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Local Node Identity */}
        <Card className="glass-panel">
          <CardHeader className="pb-3">
            <CardTitle className="text-white flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              This Node's Identity
            </CardTitle>
            <CardDescription>Public federation metadata and cryptographic identity.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingLocal ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : !localMeta ? (
              <div className="text-center py-6">
                <Shield className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground text-sm mb-3">Could not load local node metadata.</p>
                <Button size="sm" onClick={() => refetchLocal()} className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20">
                  Retry
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: "Protocol", value: localMeta.protocol, mono: true },
                    { label: "Node Name", value: localMeta.name },
                    { label: "Region", value: localMeta.region },
                    { label: "Active Sites", value: String(localMeta.activeSites), mono: true },
                  ].map(({ label, value, mono }) => (
                    <div key={label} className="bg-background/30 rounded-lg p-2.5">
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
                      <p className={`text-white text-sm truncate ${mono ? "font-mono" : ""}`}>{value}</p>
                    </div>
                  ))}
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Capabilities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {localMeta.capabilities.map((cap) => (
                      <Badge key={cap} variant="outline" className="border-primary/20 text-primary text-xs py-0">{cap}</Badge>
                    ))}
                  </div>
                </div>

                {localMeta.publicKey ? (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Shield className="w-3 h-3" /> Public Key (Ed25519 / SPKI)
                    </p>
                    <Textarea
                      readOnly
                      value={localMeta.publicKey}
                      className="h-20 font-mono text-[10px] bg-black/30 border-primary/10 text-primary/80 resize-none leading-relaxed"
                    />
                  </div>
                ) : (
                  <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-yellow-400 font-medium text-sm">No key pair</p>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Go to Federation Nodes → Generate Keys to enable cryptographic verification.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Handshake Panel */}
        <Card className="glass-panel">
          <CardHeader className="pb-3">
            <CardTitle className="text-white flex items-center gap-2">
              <Radio className="w-5 h-5 text-primary" />
              Connect to a Peer Node
            </CardTitle>
            <CardDescription>
              Enter a remote node's URL to initiate a cryptographically signed handshake and join its federation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-sm">Remote Node URL</Label>
              <Input
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doHandshake()}
                placeholder="https://other-node.example.com"
                className="bg-background/40 border-white/10 text-white font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">Node must expose <code className="text-primary">/.well-known/federation</code></p>
            </div>

            <Button
              onClick={doHandshake}
              disabled={handshaking || !targetUrl || targetUrl === "https://"}
              className="w-full bg-primary text-black hover:bg-primary/90 font-semibold shadow-lg shadow-primary/20"
            >
              {handshaking ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting…</>
              ) : (
                <><Radio className="w-4 h-4 mr-2" />Initiate Handshake</>
              )}
            </Button>

            <AnimatePresence>
              {handshakeResult && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={`rounded-xl p-4 border ${handshakeResult.success
                    ? "bg-status-active/5 border-status-active/20"
                    : "bg-red-500/5 border-red-500/20"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {handshakeResult.success
                      ? <CheckCircle className="w-4 h-4 text-status-active" />
                      : <XCircle className="w-4 h-4 text-red-400" />
                    }
                    <span className={`font-semibold text-sm ${handshakeResult.success ? "text-status-active" : "text-red-400"}`}>
                      {handshakeResult.success ? "Connection verified" : "Connection failed"}
                    </span>
                  </div>
                  {handshakeResult.error && (
                    <p className="text-red-400 text-xs font-mono">{handshakeResult.error}</p>
                  )}
                  {handshakeResult.discoveryData && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mt-2">
                      <p className="text-muted-foreground">Name: <span className="text-white">{handshakeResult.discoveryData.name}</span></p>
                      <p className="text-muted-foreground">Protocol: <span className="text-white font-mono">{handshakeResult.discoveryData.protocol}</span></p>
                      <p className="text-muted-foreground">Region: <span className="text-white">{handshakeResult.discoveryData.region}</span></p>
                      <p className="text-muted-foreground">Sites: <span className="text-white">{handshakeResult.discoveryData.activeSites}</span></p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>

      {/* Federation Peers */}
      <Card className="glass-panel">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-secondary" />
              Federation Peers
              {!loadingPeers && (
                <Badge variant="outline" className="ml-1 text-xs border-white/10 text-muted-foreground font-mono">
                  {onlineCount}/{totalPeers}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              All known peers — auto-checked every 2 min. Last updated:{" "}
              {peersUpdatedAt ? formatDistanceToNow(new Date(peersUpdatedAt), { addSuffix: true }) : "—"}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-white"
            onClick={() => refetchPeers()}
            disabled={loadingPeers}
          >
            {loadingPeers ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </CardHeader>
        <CardContent>
          {loadingPeers ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : !peers || peers.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-white/10 rounded-xl">
              <Radio className="w-10 h-10 mx-auto mb-3 text-muted-foreground/40" />
              <p className="text-white font-medium mb-1">No peers connected</p>
              <p className="text-muted-foreground text-sm max-w-sm mx-auto">
                Use the handshake form above to connect to another Nexus Hosting node.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {peers.map((peer, i) => {
                const cfg = STATUS_CONFIG[peer.status] ?? STATUS_CONFIG.inactive;
                return (
                  <motion.div
                    key={peer.id}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="bg-white/5 border border-white/5 rounded-xl p-4 hover:border-white/10 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusDot status={peer.status} />
                        <span className="font-semibold text-white text-sm truncate">{peer.name}</span>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ml-2 ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                    </div>
                    <p className="text-primary/70 font-mono text-xs truncate mb-3">{peer.domain}</p>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Region: <span className="text-white/70">{peer.region}</span></span>
                      <span>Sites: <span className="text-white/70 font-mono">{peer.siteCount}</span></span>
                      {peer.trustLevel && (
                        <span className="col-span-2 flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                            peer.trustLevel === "trusted"    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" :
                            peer.trustLevel === "verified"   ? "bg-blue-500/15 border-blue-500/30 text-blue-400" :
                            peer.trustLevel === "blocked"    ? "bg-red-500/15 border-red-500/30 text-red-400" :
                                                               "bg-white/5 border-white/10 text-muted-foreground"
                          }`}>
                            {peer.trustLevel === "trusted"  ? "✓ trusted" :
                             peer.trustLevel === "verified" ? "● verified" :
                             peer.trustLevel === "blocked"  ? "✕ blocked" : "○ unverified"}
                          </span>
                        </span>
                      )}
                      <span className="col-span-2 flex items-center gap-1">
                        <Clock className="w-3 h-3 shrink-0" />
                        {peer.lastSeenAt
                          ? `Seen ${formatDistanceToNow(new Date(peer.lastSeenAt), { addSuffix: true })}`
                          : peer.verifiedAt
                            ? `Verified ${formatDistanceToNow(new Date(peer.verifiedAt), { addSuffix: true })}`
                            : "Never contacted"
                        }
                      </span>
                    </div>
                    {peer.publicKey && (
                      <div className="mt-2 pt-2 border-t border-white/5">
                        <p className="text-[10px] text-primary/50 font-mono truncate">🔑 {peer.publicKey.slice(0, 32)}…</p>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Log */}
      <Card className="glass-panel">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Federation Event Log
            </CardTitle>
            <CardDescription>
              Live activity — auto-refreshes every 30 s. Last updated:{" "}
              {eventsUpdatedAt ? formatDistanceToNow(new Date(eventsUpdatedAt), { addSuffix: true }) : "—"}
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-white"
            onClick={() => refetchEvents()}
            disabled={loadingEvents}
          >
            {loadingEvents ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </CardHeader>
        <CardContent>
          {loadingEvents ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />)}
            </div>
          ) : !events || events.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-white/10 rounded-xl">
              <Activity className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">No events yet. Try a handshake or deploy a site.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {events.map((ev, i) => (
                <motion.div
                  key={ev.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                  className="bg-background/30 rounded-lg px-3 py-2 flex items-center gap-3"
                >
                  <Badge variant="outline" className={`text-xs shrink-0 ${EVENT_COLORS[ev.eventType] ?? "border-white/10 text-muted-foreground"}`}>
                    {ev.eventType.replace(/_/g, " ")}
                  </Badge>
                  <span className="text-white text-xs font-mono truncate flex-1">{ev.fromNodeDomain}</span>
                  {ev.toNodeDomain && (
                    <span className="text-muted-foreground text-xs shrink-0 hidden sm:block">→ {ev.toNodeDomain}</span>
                  )}
                  <span className={`text-xs shrink-0 ${ev.verified ? "text-status-active" : "text-muted-foreground"}`}>
                    {ev.verified ? "✓ signed" : "unsigned"}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0 font-mono">
                    {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blocklist Card */}
      <BlocklistCard />

      {/* Protocol Reference (collapsible) */}
      <Card className="glass-panel">
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setShowProtocolRef((v) => !v)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2 text-base">
              <Globe className="w-4 h-4 text-primary" />
              Protocol Reference
            </CardTitle>
            {showProtocolRef ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        <AnimatePresence>
          {showProtocolRef && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <CardContent className="pt-0">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  {[
                    { method: "GET", path: "/.well-known/federation", desc: "Node discovery — public metadata & key" },
                    { method: "POST", path: "/api/federation/ping", desc: "Receive a signed ping from another node" },
                    { method: "POST", path: "/api/federation/handshake", desc: "Initiate handshake with a remote node" },
                    { method: "GET", path: "/api/federation/peers", desc: "List all registered federation peers" },
                    { method: "GET", path: "/api/federation/events", desc: "Federation event log (last 50)" },
                    { method: "POST", path: "/api/federation/notify-sync", desc: "Notify peers of a site deployment" },
                    { method: "GET", path: "/api/sites/serve/:domain/*", desc: "Serve hosted site files by domain" },
                    { method: "POST", path: "/api/nodes/:id/generate-keys", desc: "Rotate Ed25519 key pair for a node" },
                    { method: "GET", path: "/api/capacity/summary", desc: "Network-wide capacity overview" },
                    { method: "GET", path: "/api/stats/hourly", desc: "24-hour hourly activity buckets" },
                  ].map((ep) => (
                    <div key={ep.path} className="bg-background/30 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${ep.method === "GET" ? "bg-blue-500/20 text-blue-400" : "bg-purple-500/20 text-purple-400"}`}>
                          {ep.method}
                        </span>
                        <code className="text-primary text-xs font-mono truncate">{ep.path}</code>
                      </div>
                      <p className="text-muted-foreground text-xs">{ep.desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </div>
  );
}
