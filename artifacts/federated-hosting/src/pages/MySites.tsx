import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { useSites } from "@/lib/apiHooks";
import { Link } from "wouter";
import { Globe, Upload, ExternalLink, Plus, LogIn, Eye, Clock, Zap, BarChart2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SiteForm } from "@/components/forms/SiteForm";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import type { Site } from "@workspace/api-client-react";

type SiteWithHits = Site & { hitCount?: number };

const STATUS_COLOR: Record<string, string> = {
  active: "bg-status-active/10 text-status-active border-status-active/30",
  suspended: "bg-status-inactive/10 text-status-inactive border-status-inactive/30",
  migrating: "bg-status-maintenance/10 text-status-maintenance border-status-maintenance/30",
};

export default function MySites() {
  const { user, isAuthenticated, login } = useAuth();
  const { data: allSites, isLoading, refetch } = useSites();
  const [registerOpen, setRegisterOpen] = useState(false);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
          <Globe className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-white mb-2">My Sites</h2>
          <p className="text-muted-foreground">Sign in to manage your hosted sites and deploy content.</p>
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
          <h1 className="text-3xl font-bold text-white tracking-tight">My Sites</h1>
          <p className="text-muted-foreground mt-1 font-mono text-sm">
            {mySites.length} site{mySites.length !== 1 ? "s" : ""} on the federation
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
              <p className="text-lg font-semibold text-white">No sites yet</p>
              <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                Register a domain, upload your HTML/CSS/JS files, and deploy to the federation network in minutes.
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
