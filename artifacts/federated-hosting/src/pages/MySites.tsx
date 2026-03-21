import { useState } from "react";
import { useAuth } from "@workspace/auth-web";
import { useSites } from "@/lib/apiHooks";
import { Link } from "wouter";
import { Globe, Upload, ExternalLink, Plus, LogIn, Eye, Clock, Zap, BarChart2, Settings, Inbox, GitBranch, Webhook, MoreHorizontal, Copy, Send, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SiteForm } from "@/components/forms/SiteForm";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/use-toast";
import type { Site } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function SiteMoreMenu({ site }: { site: Site & { hitCount?: number; replicaCount?: number } }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [cloneName, setCloneName] = useState(`${site.name} (copy)`);
  const [cloneDomain, setCloneDomain] = useState(`${site.domain}-copy`);
  const [transferEmail, setTransferEmail] = useState("");

  const cloneMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${site.id}/clone`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cloneName, domain: cloneDomain }),
      });
      if (!r.ok) { const b = await r.json() as { message?: string }; throw new Error(b.message ?? "Failed"); }
      return r.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["sites"] });
      setCloneOpen(false);
      toast({ title: "Site cloned", description: `${data.name} is ready — no storage duplicated.` });
    },
    onError: (e: Error) => toast({ title: "Clone failed", description: e.message, variant: "destructive" }),
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/sites/${site.id}/transfer`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail: transferEmail }),
      });
      if (!r.ok) { const b = await r.json() as { message?: string }; throw new Error(b.message ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      setTransferOpen(false);
      toast({ title: "Transfer initiated", description: `${transferEmail} must accept the transfer within 24 hours.` });
    },
    onError: (e: Error) => toast({ title: "Transfer failed", description: e.message, variant: "destructive" }),
  });

  const exportSite = async () => {
    try {
      const r = await fetch(`${BASE}/api/sites/${site.id}/export`, { credentials: "include" });
      if (!r.ok) throw new Error("Export failed");
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${site.domain}-export.json`; a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Site exported" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="border-white/10 text-muted-foreground hover:text-white" title="More actions">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 bg-card border-white/10">
          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => setCloneOpen(true)}>
            <Copy className="w-3.5 h-3.5" />Clone site
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={() => setTransferOpen(true)}>
            <Send className="w-3.5 h-3.5" />Transfer ownership
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 cursor-pointer" onClick={exportSite}>
            <Download className="w-3.5 h-3.5" />Export manifest
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Clone dialog */}
      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="sm:max-w-sm border-white/10 bg-card">
          <DialogHeader><DialogTitle className="text-white">Clone site</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">New site name</label>
              <input value={cloneName} onChange={e => setCloneName(e.target.value)}
                className="w-full bg-muted/20 border border-white/8 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">New domain</label>
              <input value={cloneDomain} onChange={e => setCloneDomain(e.target.value)}
                className="w-full bg-muted/20 border border-white/8 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-primary/40" />
            </div>
            <p className="text-xs text-muted-foreground">Files are reused — no storage duplicated.</p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 border-white/10" onClick={() => setCloneOpen(false)}>Cancel</Button>
              <Button className="flex-1" onClick={() => cloneMutation.mutate()} disabled={!cloneName || !cloneDomain || cloneMutation.isPending}>
                {cloneMutation.isPending ? "Cloning…" : "Clone"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-sm border-white/10 bg-card">
          <DialogHeader><DialogTitle className="text-white">Transfer ownership</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">New owner's email</label>
              <input type="email" value={transferEmail} onChange={e => setTransferEmail(e.target.value)}
                placeholder="newowner@example.com"
                className="w-full bg-muted/20 border border-white/8 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary/40" />
            </div>
            <p className="text-xs text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded-lg p-2">
              The new owner must accept within 24 hours. You'll lose ownership immediately upon acceptance.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 border-white/10" onClick={() => setTransferOpen(false)}>Cancel</Button>
              <Button className="flex-1 bg-amber-500/20 border-amber-500/30 text-amber-400 hover:bg-amber-500/30"
                variant="outline" onClick={() => transferMutation.mutate()}
                disabled={!transferEmail || transferMutation.isPending}>
                {transferMutation.isPending ? "Sending…" : "Initiate transfer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type SiteWithHits = Site & { hitCount?: number };

const STATUS_COLOR: Record<string, string> = {
  active: "bg-status-active/10 text-status-active border-status-active/30",
  suspended: "bg-status-inactive/10 text-status-inactive border-status-inactive/30",
  migrating: "bg-status-maintenance/10 text-status-maintenance border-status-maintenance/30",
};

export default function MySites() {
  const { user, isAuthenticated, login } = useAuth();
  const { t } = useTranslation();
  const { data: allSites, isLoading, refetch } = useSites();
  const [registerOpen, setRegisterOpen] = useState(false);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
          <Globe className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">{t("mySites.title")}</h2>
          <p className="text-muted-foreground">{t("mySites.signInPrompt")}</p>
        </div>
        <Button onClick={login} className="bg-primary text-black hover:bg-primary/90 font-semibold">
          <LogIn className="w-4 h-4 mr-2" />
          Sign In to Continue
        </Button>
      </div>
    );
  }

  const mySites = (allSites as SiteWithHits[]).filter((s) => s.ownerId === user?.id) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">{t("mySites.title")}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            {t("mySites.subtitle_other", { count: mySites.length })}
          </p>
        </div>

        <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-black hover:bg-primary/90 font-semibold shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" />
              Register Site
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] border-white/10 bg-card">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Register New Site</DialogTitle>
            </DialogHeader>
            <SiteForm onSuccess={() => { setRegisterOpen(false); refetch(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 rounded-xl bg-card/50 border border-white/5 animate-pulse" />
          ))}
        </div>
      ) : mySites.length === 0 ? (
        <Card className="bg-card/50 border-dashed border-white/10">
          <CardContent className="flex flex-col items-center gap-5 py-16">
            <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
              <Globe className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-white">{t("mySites.noSites")}</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                {t("mySites.noSitesHint")}
              </p>
            </div>
            <div className="flex flex-col items-center gap-3 w-full max-w-xs">
              <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full bg-primary text-black hover:bg-primary/90 font-semibold">
                    <Plus className="w-4 h-4 mr-2" />
                    Register Your First Site
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[600px] border-white/10 bg-card">
                  <DialogHeader>
                    <DialogTitle className="font-display text-2xl">Register New Site</DialogTitle>
                  </DialogHeader>
                  <SiteForm onSuccess={() => { setRegisterOpen(false); refetch(); }} />
                </DialogContent>
              </Dialog>
              <p className="text-xs text-muted-foreground font-mono text-center">
                Free · Decentralized · No vendor lock-in
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {mySites.map((site, i) => (
            <motion.div
              key={site.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <Card className="bg-card/50 border-white/5 hover:border-primary/25 transition-all duration-300 group h-full flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-white text-base truncate group-hover:text-primary transition-colors">
                        {site.name}
                      </CardTitle>
                      <CardDescription className="text-primary/80 font-mono text-xs truncate mt-0.5">
                        {site.domain}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={`shrink-0 text-xs ${STATUS_COLOR[site.status] ?? ""}`}>
                      {site.status}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex-1 flex flex-col gap-4">
                  {site.description && (
                    <p className="text-muted-foreground text-xs line-clamp-2">{site.description}</p>
                  )}

                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="bg-background/30 rounded-lg p-2 flex flex-col gap-0.5">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Eye className="w-3 h-3" /> Visits
                      </span>
                      <span className="text-white font-mono font-semibold">
                        {((site as SiteWithHits).hitCount ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="bg-background/30 rounded-lg p-2 flex flex-col gap-0.5">
                      <span className="text-muted-foreground">Storage</span>
                      <span className="text-white font-mono font-semibold">
                        {site.storageUsedMb.toFixed(1)} MB
                      </span>
                    </div>
                    <div className="bg-background/30 rounded-lg p-2 flex flex-col gap-0.5">
                      <span className="text-muted-foreground capitalize">{site.siteType}</span>
                      <span className="text-white font-mono font-semibold truncate">
                        {site.replicaCount}x nodes
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono mt-auto">
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>Updated {formatDistanceToNow(new Date(site.updatedAt), { addSuffix: true })}</span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <Link href={`/deploy/${site.id}`} className="flex-1">
                      <Button
                        size="sm"
                        className="w-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 font-semibold"
                      >
                        <Zap className="w-3.5 h-3.5 mr-1.5" />
                        Deploy
                      </Button>
                    </Link>
                    <Link href={`/analytics/${site.id}`}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/10 text-muted-foreground hover:text-white"
                        title="View analytics"
                      >
                        <BarChart2 className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Link href={`/sites/${site.id}/settings`}>
                      <Button size="sm" variant="outline" className="border-white/10 text-muted-foreground hover:text-white" title="Site settings">
                        <Settings className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Link href={`/sites/${site.id}/forms`}>
                      <Button size="sm" variant="outline" className="border-white/10 text-muted-foreground hover:text-white" title="Form submissions">
                        <Inbox className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <Link href={`/sites/${site.id}/webhooks`}>
                      <Button size="sm" variant="outline" className="border-white/10 text-muted-foreground hover:text-white" title="Webhooks"><Webhook className="w-3.5 h-3.5" /></Button>
                    </Link>
                    <Link href={`/sites/${site.id}/builds`}>
                      <Button size="sm" variant="outline" className="border-white/10 text-muted-foreground hover:text-white" title="Build history">
                        <GitBranch className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <a
                      href={`/api/sites/serve/${site.domain}/index.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/10 text-muted-foreground hover:text-white"
                        title="Open live site"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                    <Link href={`/sites/${site.id}`}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/10 text-muted-foreground hover:text-white"
                        title="Site settings"
                      >
                        <Globe className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                    <SiteMoreMenu site={site} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
