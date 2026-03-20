import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@workspace/auth-web";
import { LoadingState } from "@/components/shared";
import {
  Webhook, Plus, Trash2, Play, ChevronLeft, CheckCircle2,
  XCircle, Clock, ToggleLeft, ToggleRight, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const EVENTS = ["deploy", "deploy_failed", "form_submission", "site_down", "site_recovered", "node_offline"];

interface WebhookRecord {
  id: number; url: string; secret: string | null; events: string;
  enabled: number; createdAt: string;
}
interface Delivery {
  id: number; event: string; statusCode: number | null; success: number;
  attempt: number; durationMs: number | null; createdAt: string; response: string | null;
}

export default function WebhooksPage() {
  const { id } = useParams<{ id: string }>();
  const siteId = parseInt(id!, 10);
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [url, setUrl]             = useState("");
  const [secret, setSecret]       = useState("");
  const [events, setEvents]       = useState<string[]>(["deploy", "deploy_failed"]);
  const [showSecret, setShowSecret] = useState(false);
  const [selectedHook, setSelectedHook] = useState<number | null>(null);

  const { data: hooks = [], isLoading } = useQuery<WebhookRecord[]>({
    queryKey: ["webhooks", siteId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/webhooks`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: isAuthenticated,
  });

  const { data: deliveries = [] } = useQuery<Delivery[]>({
    queryKey: ["webhook-deliveries", selectedHook],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/webhooks/${selectedHook}/deliveries`, { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: !!selectedHook,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/webhooks`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, secret: secret || undefined, events: events.join(","), enabled: true }),
      });
      if (!r.ok) throw new Error((await r.json() as any).message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webhooks", siteId] });
      setUrl(""); setSecret(""); setEvents(["deploy", "deploy_failed"]);
      toast({ title: "Webhook created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ hookId, enabled }: { hookId: number; enabled: boolean }) => {
      const r = await fetch(`${BASE}/api/sites/${siteId}/webhooks/${hookId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks", siteId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (hookId: number) => {
      await fetch(`${BASE}/api/sites/${siteId}/webhooks/${hookId}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks", siteId] }); setSelectedHook(null); },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/webhooks/test`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteId }),
      });
      if (!r.ok) throw new Error("Test failed");
    },
    onSuccess: () => toast({ title: "Test webhook sent" }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleEvent = (e: string) =>
    setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);

  if (!isAuthenticated) return <div className="p-8 text-muted-foreground">Sign in to manage webhooks.</div>;

  return (
    <div className="space-y-6 pb-12 max-w-3xl animate-in fade-in duration-500">
      <div className="flex items-center gap-3">
        <Link href={`/sites/${siteId}/settings`}>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-white">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Webhook className="w-5 h-5 text-primary" />Webhooks
          </h1>
          <p className="text-muted-foreground text-sm">Receive HTTP POST callbacks on site events</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending} className="gap-1.5 border-white/10">
          <Play className="w-3.5 h-3.5" />Test all
        </Button>
      </div>

      {/* Existing hooks */}
      {isLoading ? <LoadingState /> : hooks.map(hook => (
        <Card key={hook.id} className={cn("border-white/5 cursor-pointer hover:border-white/10 transition-colors",
          selectedHook === hook.id && "border-primary/30 bg-primary/5")}
          onClick={() => setSelectedHook(selectedHook === hook.id ? null : hook.id)}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-mono truncate">{hook.url}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {hook.events === "*"
                    ? <Badge variant="outline" className="border-white/10 text-xs">all events</Badge>
                    : hook.events.split(",").map(e => (
                        <Badge key={e} variant="outline" className="border-primary/20 text-primary text-xs">{e}</Badge>
                      ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={e => { e.stopPropagation(); toggleMutation.mutate({ hookId: hook.id, enabled: !hook.enabled }); }}
                  className="text-muted-foreground hover:text-white transition-colors">
                  {hook.enabled
                    ? <ToggleRight className="w-5 h-5 text-green-400" />
                    : <ToggleLeft className="w-5 h-5" />}
                </button>
                <button onClick={e => { e.stopPropagation(); if (confirm("Delete this webhook?")) deleteMutation.mutate(hook.id); }}
                  className="text-muted-foreground hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Delivery history */}
            {selectedHook === hook.id && deliveries.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/5 space-y-1.5">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">Recent deliveries</p>
                {deliveries.slice(0, 10).map(d => (
                  <div key={d.id} className="flex items-center gap-2 text-xs">
                    {d.success
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    <span className="text-muted-foreground w-28 truncate">{d.event}</span>
                    <span className={cn("font-mono", d.statusCode && d.statusCode < 300 ? "text-green-400" : "text-red-400")}>
                      {d.statusCode ?? "err"}
                    </span>
                    <span className="text-muted-foreground">{d.durationMs}ms</span>
                    {d.attempt > 1 && <Badge variant="outline" className="border-amber-500/30 text-amber-400 text-xs py-0">retry {d.attempt}</Badge>}
                    <span className="text-muted-foreground ml-auto">{new Date(d.createdAt).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {hooks.length === 0 && !isLoading && (
        <div className="text-center py-12 text-muted-foreground border border-dashed border-white/10 rounded-xl">
          <Webhook className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No webhooks yet. Add one below.</p>
        </div>
      )}

      {/* Add webhook form */}
      <Card className="border-white/5">
        <CardHeader>
          <CardTitle className="text-white text-base flex items-center gap-2"><Plus className="w-4 h-4" />Add webhook</CardTitle>
          <CardDescription>FedHost will POST a signed JSON payload to this URL on the selected events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="https://your-server.com/webhook" value={url} onChange={e => setUrl(e.target.value)}
            className="bg-muted/20 border-white/8 font-mono text-sm" />
          <div className="relative">
            <Input placeholder="Webhook secret (optional)" type={showSecret ? "text" : "password"}
              value={secret} onChange={e => setSecret(e.target.value)}
              className="bg-muted/20 border-white/8 font-mono text-sm pr-10" />
            <button onClick={() => setShowSecret(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white">
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Events to subscribe to:</p>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map(e => (
                <button key={e} onClick={() => toggleEvent(e)}
                  className={cn("text-xs px-2.5 py-1 rounded-full border transition-all font-mono",
                    events.includes(e)
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-white/10 text-muted-foreground hover:border-white/20")}>
                  {e}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!url || createMutation.isPending} className="gap-1.5">
            <Plus className="w-4 h-4" />{createMutation.isPending ? "Adding…" : "Add Webhook"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
