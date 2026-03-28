import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@workspace/auth-web";
import { LoadingState } from "@/components/shared";
import { Inbox, Download, Trash2, Mail, MailOpen, AlertTriangle, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Submission {
  id: number; formName: string;
  data: Record<string, string>;
  spamScore: number; flagged: number; read: number;
  createdAt: string;
}
interface FormsResp {
  data: Submission[];
  meta: { total: number; page: number; limit: number };
  forms: Array<{ formName: string; count: number }>;
}

export default function FormInbox() {
  const { id } = useParams<{ id: string }>();
  const siteId = parseInt(id!, 10);
  const { isAuthenticated } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [activeForm, setActiveForm] = useState<string | undefined>();
  const [showFlagged, setShowFlagged] = useState(false);
  const [selected, setSelected] = useState<Submission | null>(null);

  const { data, isLoading } = useQuery<FormsResp>({
    queryKey: ["forms", siteId, activeForm, showFlagged],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: "50" });
      if (activeForm) qs.set("form", activeForm);
      const r = await fetch(`${BASE}/api/sites/${siteId}/forms?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: isAuthenticated,
  });

  const markReadMutation = useMutation({
    mutationFn: async (subId: number) => {
      await fetch(`${BASE}/api/sites/${siteId}/forms/${subId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: 1 }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forms", siteId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (subId: number) => {
      await fetch(`${BASE}/api/sites/${siteId}/forms/${subId}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["forms", siteId] }); setSelected(null); toast({ title: "Deleted" }); },
  });

  const exportCSV = async (formName: string) => {
    const r = await fetch(`${BASE}/api/sites/${siteId}/forms/${formName}/export`, { credentials: "include" });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${formName}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const submissions = showFlagged ? (data?.data ?? []).filter(s => s.flagged) : (data?.data ?? []).filter(s => !s.flagged);

  if (!isAuthenticated) return <div className="p-8 text-muted-foreground">Sign in to view form submissions.</div>;

  return (
    <div className="flex h-full gap-4 animate-in fade-in duration-500">
      {/* Sidebar */}
      <div className="w-56 shrink-0 space-y-2">
        <div className="px-2 py-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Forms</h2>
        </div>
        <button onClick={() => { setActiveForm(undefined); setShowFlagged(false); }}
          className={cn("w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
            !activeForm && !showFlagged ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-white hover:bg-white/5")}>
          <Inbox className="w-4 h-4" />All submissions
          <span className="ml-auto text-xs">{data?.meta.total ?? 0}</span>
        </button>
        <button onClick={() => { setActiveForm(undefined); setShowFlagged(true); }}
          className={cn("w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
            showFlagged ? "bg-red-500/10 text-red-400" : "text-muted-foreground hover:text-white hover:bg-white/5")}>
          <AlertTriangle className="w-4 h-4" />Spam
        </button>
        <div className="border-t border-white/5 pt-2">
          {(data?.forms ?? []).map(f => (
            <div key={f.formName} className="flex items-center">
              <button onClick={() => { setActiveForm(f.formName); setShowFlagged(false); }}
                className={cn("flex-1 text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-colors",
                  activeForm === f.formName ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-white hover:bg-white/5")}>
                <Filter className="w-3.5 h-3.5" />{f.formName}
                <span className="ml-auto text-xs">{f.count}</span>
              </button>
              <button onClick={() => exportCSV(f.formName)} title="Export CSV" className="p-1.5 text-muted-foreground hover:text-white">
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-w-0 space-y-2">
        {isLoading ? <LoadingState /> : submissions.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Inbox className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No submissions yet.</p>
            <p className="text-xs mt-1">Add a form to your site pointing to your NexusHosting node.</p>
          </div>
        ) : submissions.map(sub => (
          <button key={sub.id} onClick={() => { setSelected(sub); markReadMutation.mutate(sub.id); }}
            className={cn("w-full text-left p-4 rounded-xl border transition-all",
              selected?.id === sub.id ? "border-primary/30 bg-primary/5" : "border-white/5 hover:border-white/10 bg-muted/5",
              !sub.read && "border-l-2 border-l-primary/60")}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {sub.read ? <MailOpen className="w-4 h-4 text-muted-foreground shrink-0" /> : <Mail className="w-4 h-4 text-primary shrink-0" />}
                <span className={cn("text-sm font-semibold", sub.read ? "text-muted-foreground" : "text-white")}>{sub.formName}</span>
                {sub.flagged ? <Badge variant="outline" className="border-red-500/30 text-red-400 text-xs">spam</Badge> : null}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{new Date(sub.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="mt-1 ml-6 text-xs text-muted-foreground truncate">
              {Object.entries(sub.data).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}
            </div>
          </button>
        ))}
      </div>

      {/* Detail pane */}
      {selected && (
        <div className="w-72 shrink-0">
          <Card className="border-white/5 sticky top-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-white text-sm flex items-center justify-between">
                {selected.formName}
                <button onClick={() => deleteMutation.mutate(selected.id)} className="text-muted-foreground hover:text-red-400 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{new Date(selected.createdAt).toLocaleString()}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(selected.data).map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-0.5">{k}</p>
                  <p className="text-sm text-white break-words">{v}</p>
                </div>
              ))}
              {selected.flagged ? (
                <div className="pt-2 border-t border-white/5 flex items-center gap-2 text-xs text-red-400">
                  <AlertTriangle className="w-3.5 h-3.5" />Spam score: {(selected.spamScore * 100).toFixed(0)}%
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
