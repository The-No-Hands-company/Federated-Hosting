import { useParams, Link, useLocation } from "wouter";
import { useGetSite, useDeleteSite } from "@workspace/api-client-react";
import { useNodes } from "@/lib/apiHooks";
import { LoadingState, ErrorState, StatusBadge } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatGb } from "@/lib/utils";
import { ArrowLeft, Globe, HardDrive, MapPin, Clock, User, Edit, Trash2, ShieldAlert, Server, ExternalLink, Activity, Copy } from "lucide-react";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SiteForm } from "@/components/forms/SiteForm";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListSitesQueryKey } from "@workspace/api-client-react";

export default function SiteDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  
  const siteId = parseInt(id || "0", 10);
  const { data: site, isLoading, error } = useGetSite(siteId);
  const { data: nodes } = useNodes();
  
  const deleteMutation = useDeleteSite({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        toast({ title: "Site Deleted", description: "Site configuration and data scheduled for removal." });
        setLocation("/sites");
      },
      onError: (err) => {
        toast({ title: "Deletion Failed", description: String(err), variant: "destructive" });
        setIsDeleteOpen(false);
      }
    }
  });

  if (isLoading) return <LoadingState />;
  if (error || !site) return <ErrorState message="Site not found or network error." />;

  const primaryNode = nodes?.find(n => n.id === site.primaryNodeId);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href="/sites">
        <Button variant="ghost" className="text-muted-foreground hover:text-white -ml-4 px-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Sites
        </Button>
      </Link>

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 bg-card/40 p-6 rounded-2xl border border-white/5 backdrop-blur-md">
        <div className="flex items-center gap-5 w-full lg:w-auto">
          <div className="w-16 h-16 rounded-2xl bg-secondary/10 flex items-center justify-center border border-secondary/30 shrink-0 shadow-[0_0_20px_-5px_rgba(153,51,255,0.3)]">
            <Globe className="w-8 h-8 text-secondary" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-1">
              <h1 className="text-3xl font-display font-bold text-white tracking-tight truncate">{site.name}</h1>
              <StatusBadge status={site.status} />
              <Badge variant="outline" className="border-secondary/30 text-secondary capitalize">{site.siteType}</Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-primary font-mono group cursor-pointer w-fit">
              <span>{site.domain}</span>
              <ExternalLink className="w-3 h-3 opacity-50 group-hover:opacity-100" />
            </div>
          </div>
        </div>
        
        <div className="flex gap-3 w-full lg:w-auto mt-4 lg:mt-0 flex-wrap">
          {/* Quick action links */}
          <Link href={`/analytics/${site.id}`}>
            <Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white gap-1.5">
              <Activity className="w-3.5 h-3.5" />Analytics
            </Button>
          </Link>
          <Link href={`/sites/${site.id}/forms`}>
            <Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white gap-1.5">
              <Copy className="w-3.5 h-3.5" />Forms
            </Button>
          </Link>
          <Link href={`/sites/${site.id}/builds`}>
            <Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white gap-1.5">
              <Server className="w-3.5 h-3.5" />Builds
            </Button>
          </Link>
          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex-1 lg:flex-none border-white/10 hover:bg-white/5">
                <Edit className="w-4 h-4 mr-2" /> Edit Site
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] border-white/10 bg-card">
              <DialogHeader>
                <DialogTitle>Edit Site: {site.name}</DialogTitle>
              </DialogHeader>
              <SiteForm initialData={{
                  id: site.id,
                  name: site.name,
                  domain: site.domain,
                  description: site.description ?? undefined,
                  siteType: site.siteType,
                  ownerName: site.ownerName,
                  ownerEmail: site.ownerEmail,
                  primaryNodeId: site.primaryNodeId ?? undefined,
                }} onSuccess={() => setIsEditOpen(false)} />
            </DialogContent>
          </Dialog>

          <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" className="flex-1 lg:flex-none bg-destructive/20 text-destructive hover:bg-destructive/40 border border-destructive/30">
                <Trash2 className="w-4 h-4 mr-2" /> Delete
              </Button>
            </DialogTrigger>
            <DialogContent className="border-destructive/30 bg-card">
              <DialogHeader>
                <DialogTitle className="text-destructive flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5" /> Confirm Site Deletion
                </DialogTitle>
                <DialogDescription className="text-muted-foreground pt-4">
                  Are you sure you want to permanently delete <strong>{site.domain}</strong>? This will remove it from the federation and schedule data deletion on all replica nodes.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: site.id })} disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? "Deleting..." : "Yes, Delete Site"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-6 lg:col-span-2">
          {site.description && (
             <Card className="glass-panel">
               <CardContent className="p-6 text-white/80 leading-relaxed">
                 {site.description}
               </CardContent>
             </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="glass-panel">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-widest text-muted-foreground font-mono flex items-center gap-2">
                  <Server className="w-4 h-4 text-primary" /> Federation Placement
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {primaryNode ? (
                  <div className="bg-black/20 p-4 rounded-xl border border-primary/20 flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 uppercase">Primary Node</div>
                        <Link href={`/nodes/${primaryNode.id}`} className="font-bold text-white hover:text-primary transition-colors cursor-pointer text-lg">
                          {primaryNode.name}
                        </Link>
                      </div>
                      <StatusBadge status={primaryNode.status} />
                    </div>
                    <div className="font-mono text-sm text-primary/70">{primaryNode.domain}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                      <MapPin className="w-3 h-3" /> Region: {primaryNode.region}
                    </div>
                  </div>
                ) : (
                  <div className="bg-black/20 p-4 rounded-xl border border-dashed border-white/10 text-center py-6">
                    <span className="text-muted-foreground italic">No primary node assigned</span>
                  </div>
                )}

                <div className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                  <span className="text-sm text-white/70">Replication Factor</span>
                  <Badge variant="outline" className="font-mono text-secondary border-secondary/30 bg-secondary/10">
                    {site.replicaCount}x
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="glass-panel">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm uppercase tracking-widest text-muted-foreground font-mono flex items-center gap-2">
                  <Activity className="w-4 h-4 text-secondary" /> Resource Usage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-black/20 p-4 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
                  <HardDrive className="w-8 h-8 text-white/20 mb-2" />
                  <div className="text-2xl sm:text-3xl font-display font-bold text-white">{formatBytes(site.storageUsedMb * 1024 * 1024)}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest mt-1">Storage Consumed</div>
                </div>
                
                <div className="bg-black/20 p-4 rounded-xl border border-white/5 flex flex-col items-center justify-center text-center">
                  <Activity className="w-8 h-8 text-white/20 mb-2" />
                  <div className="text-2xl sm:text-3xl font-display font-bold text-white">{formatGb(site.monthlyBandwidthGb)}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-widest mt-1">Bandwidth (30d)</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6 lg:col-span-1">
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg">Ownership</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center border border-white/20">
                  <User className="w-5 h-5 text-white/70" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-white text-sm truncate">{site.ownerName}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate">{site.ownerEmail}</p>
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-white/5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-mono text-white/80">{format(new Date(site.createdAt), "MMM d, yyyy")}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Last Updated</span>
                  <span className="font-mono text-white/80">{format(new Date(site.updatedAt), "MMM d, yyyy")}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
