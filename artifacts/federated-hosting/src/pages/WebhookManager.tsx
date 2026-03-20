import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@workspace/auth-web";
import { LoadingState } from "@/components/shared";
import {
  Webhook, Plus, Trash2, Play, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, RefreshCw, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ALL_EVENTS = ["deploy", "deploy_failed", "form_submission", "site_down", "site_recovered", "node_offline", "node_online"] as const;

interface WebhookRow {
  id: number; siteId: number; url: string; secret: string | null;
  events: string; enabled: number; createdAt: string;
}

interface Delivery {
  id: number; event: string; statusCode: number | null; success: number;
  attempt: number; durationMs: number | null; createdAt: string; response: string | null;
}

export default function WebhookManager() {
  const { id } = useParams<{ id: string }>();
  const siteId = parseInt(id!, 10);
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [newUrl, setNewUrl]         = useState("");
  const [newSecret, setNewSecret]   = useState("");
  const [newEvents, setNewEvents]   = useState<string[]>(["deploy", "deploy_failed"]);
  const [expanded, setExpanded]     = useState<number | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const { data: hooks = [], isLoading } = useQuery<WebhookRow[]>({
    queryKey: ["webhooks", siteId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/webhooks`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAuthenticated,
  });

  const { data: deliveries = [] } = useQuery<Delivery[]>({
    queryKey: ["webhook-deliveries", siteId, expanded],
    queryFn: async () => {
      if (!expanded) return [];
      const r = await fetch(`${BASE}/api/sites/${siteId}/webhooks/${expanded}/deliveries`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!expanded,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/webhooks`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl, secret: newSecret || undefined, events: newEvents }),
      });
      if (!r.ok) throw new Error((await r.json() as any).message ?? "Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhooks", siteId] });
      setNewUrl(""); setNewSecret(""); setNewEvents(["deploy", "deploy_failed"]);
      toast({ title: "Webhook created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ hookId, enabled }: { hookId: number; enabled: boolean }) => {
      await fetch(`${BASE}/api/sites/${siteId}/webhooks/${hookId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks", siteId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (hookId: number) => {
      await fetch(`${BASE}/api/sites/${siteId}/webhooks/${hookId}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks", siteId] }); toast({ title: "Webhook deleted" }); },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/webhooks/test`, { method: "POST", credentials: "include" });
      if (!r.ok) throw new Error("Test failed");
    },
    onSuccess: () => toast({ title: "Test webhook sent" }),
    onError: () => toast({ title: "Test failed", variant: "destructive" }),
  });

  if (!isAuthenticated) return <div className="p-8 text-muted-foreground">Sign in to manage webhooks.</div>;

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Webhooks</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Get notified when events happen on your site.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => testMutation.mutate()} disabled={testMutation.isPending}
          className="gap-1.5 border-white/10 text-muted-foreground hover:text-white">
          <Play className="w-3.5 h-3.5" />Send test
        </Button>
      </div>

      {/* Existing webhooks */}
      {isLoading ? <LoadingState /> : (
        <div className="space-y-3">
          {hooks.map(hook => (
            <Card key={hook.id} className={cn("border-white/5 transition-all", !hook.enabled && "opacity-60")}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn("w-2 h-2 rounded-full mt-2 shrink-0", hook.enabled ? "bg-green-400" : "bg-muted-foreground")} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-mono truncate">{hook.url}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {(hook.events === "*" ? ["all events"] : hook.events.split(","))
                        .map(e => <Badge key={e} variant="outline" className="text-xs border-white/10">{e}</Badge>)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-white"
                      onClick={() => toggleMutation.mutate({ hookId: hook.id, enabled: !hook.enabled })}>
                      {hook.enabled
                        ? <EyeOff className="w-3.5 h-3.5" />
                        : <Eye className="w-3.5 h-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-white"
                      onClick={() => setExpanded(expanded === hook.id ? null : hook.id)}>
                      {expanded === hook.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-400"
                      onClick={() => { if (confirm("Delete this webhook?")) deleteMutation.mutate(hook.id); }}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Delivery history */}
                {expanded === hook.id && (
                  <div className="mt-4 border-t border-white/5 pt-4 space-y-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">Recent deliveries</p>
                    {deliveries.length === 0
                      ? <p className="text-muted-foreground text-xs">No deliveries yet.</p>
                      : deliveries.slice(0, 10).map(d => (
                        <div key={d.id} className="flex items-center gap-3 text-xs">
                          {d.success
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                            : d.attempt >= 5
                            ? <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            : <RefreshCw className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                          <span className="text-muted-foreground w-28 shrink-0">{d.event}</span>
                          <span className={cn("font-mono shrink-0", d.statusCode && d.statusCode >= 200 && d.statusCode < 300 ? "text-green-400" : "text-red-400")}>
                            {d.statusCode ?? "—"}
                          </span>
                          <span className="text-muted-foreground shrink-0">{d.durationMs}ms</span>
                          <span className="text-muted-foreground ml-auto">{formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}</span>
                          {d.attempt > 1 && <span className="text-amber-400">attempt {d.attempt}</span>}
                        </div>
                      ))
                    }
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create new webhook */}
      <Card className="border-white/5">
        <CardHeader>
          <CardTitle className="text-white text-base flex items-center gap-2"><Plus className="w-4 h-4" />Add webhook</CardTitle>
          <CardDescription>Webhooks are signed with Ed25519 — verify with the <code className="text-xs">X-FedHost-Signature</code> header.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Endpoint URL (must be HTTPS)</Label>
            <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://hooks.example.com/fedhost"
              className="bg-muted/20 border-white/8 font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Secret (optional — sent as X-Webhook-Secret header)</Label>
            <div className="flex gap-2">
              <Input value={newSecret} onChange={e => setNewSecret(e.target.value)} type={showSecret ? "text" : "password"}
                placeholder="Shared secret for verification"
                className="bg-muted/20 border-white/8 flex-1" />
              <Button variant="ghost" size="icon" className="border border-white/8" onClick={() => setShowSecret(s => !s)}>
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Events</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map(e => (
                <button key={e} onClick={() => setNewEvents(ev => ev.includes(e) ? ev.filter(x => x !== e) : [...ev, e])}
                  className={cn("px-2.5 py-1 rounded-lg text-xs border transition-all",
                    newEvents.includes(e) ? "bg-primary/10 border-primary/30 text-primary" : "border-white/8 text-muted-foreground hover:border-white/20")}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!newUrl || createMutation.isPending} className="gap-1.5">
            <Webhook className="w-4 h-4" />{createMutation.isPending ? "Creating…" : "Add webhook"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
