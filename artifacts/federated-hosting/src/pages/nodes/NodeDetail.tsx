import { useParams, Link, useLocation } from "wouter";
import { useGetNode, useListSites, useDeleteNode } from "@workspace/api-client-react";
import { LoadingState, ErrorState, StatusBadge } from "@/components/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatGb, formatPercent, formatBytes } from "@/lib/utils";
import { ArrowLeft, Server, Activity, HardDrive, MapPin, Globe, Clock, User, Shield, Edit, Trash2, ShieldAlert, Key, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { NodeForm } from "@/components/forms/NodeForm";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getListNodesQueryKey, getGetNodeQueryKey } from "@workspace/api-client-react";

export default function NodeDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [generatingKeys, setGeneratingKeys] = useState(false);

  const generateKeys = async () => {
    setGeneratingKeys(true);
    try {
      const res = await fetch(`/api/nodes/${nodeId}/generate-keys`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      await queryClient.invalidateQueries({ queryKey: getGetNodeQueryKey(nodeId) });
      toast({ title: "Keys Generated", description: "Ed25519 key pair created. This node can now sign federation messages." });
    } catch (err: any) {
      toast({ title: "Key Generation Failed", description: err.message, variant: "destructive" });
    } finally {
      setGeneratingKeys(false);
    }
  };
  
  const nodeId = parseInt(id || "0", 10);
  const { data: node, isLoading, error } = useGetNode(nodeId);
  const { data: sites } = useListSites();
  
  const deleteMutation = useDeleteNode({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNodesQueryKey() });
        toast({ title: "Node Removed", description: "Node has been disconnected from the federation." });
        setLocation("/nodes");
      },
      onError: (err) => {
        toast({ title: "Removal Failed", description: String(err), variant: "destructive" });
        setIsDeleteOpen(false);
      }
    }
  });

  if (isLoading) return <LoadingState />;
  if (error || !node) return <ErrorState message="Node not found or network error." />;

  const nodeSites = sites?.filter(s => s.primaryNodeId === node.id) || [];
  const usedStorage = nodeSites.reduce((acc, site) => acc + site.storageUsedMb, 0) / 1024; // convert MB to GB
  const storagePercent = Math.min((usedStorage / node.storageCapacityGb) * 100, 100);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <Link href="/nodes">
        <Button variant="ghost" className="text-muted-foreground hover:text-white -ml-4 px-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Nodes
        </Button>
      </Link>

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 bg-card/40 p-6 rounded-2xl border border-white/5 backdrop-blur-md">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/30 tech-glow">
            <Server className="w-8 h-8 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-display font-bold text-white tracking-tight">{node.name}</h1>
              <StatusBadge status={node.status} />
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono">
              <span className="flex items-center gap-1.5"><Globe className="w-4 h-4" /> {node.domain}</span>
              <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {node.region}</span>
            </div>
          </div>
        </div>
        
        <div className="flex gap-3 w-full lg:w-auto mt-4 lg:mt-0">
          <Button
            variant="outline"
            className="flex-1 lg:flex-none border-primary/20 text-primary hover:bg-primary/10"
            onClick={generateKeys}
            disabled={generatingKeys}
          >
            {generatingKeys ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
            {node.publicKey ? "Rotate Keys" : "Generate Keys"}
          </Button>

          <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex-1 lg:flex-none border-white/10 hover:bg-white/5">
                <Edit className="w-4 h-4 mr-2" /> Configure
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[600px] border-white/10 bg-card">
              <DialogHeader>
                <DialogTitle>Configure Node: {node.name}</DialogTitle>
              </DialogHeader>
              <NodeForm initialData={{
                  id: node.id,
                  name: node.name,
                  domain: node.domain,
                  description: node.description ?? undefined,
                  region: node.region,
                  operatorName: node.operatorName,
                  operatorEmail: node.operatorEmail,
                  storageCapacityGb: node.storageCapacityGb,
                  bandwidthCapacityGb: node.bandwidthCapacityGb,
                  publicKey: node.publicKey ?? undefined,
                }} onSuccess={() => setIsEditOpen(false)} />
            </DialogContent>
          </Dialog>

          <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" className="flex-1 lg:flex-none bg-destructive/20 text-destructive hover:bg-destructive/40 border border-destructive/30">
                <Trash2 className="w-4 h-4 mr-2" /> Remove
              </Button>
            </DialogTrigger>
            <DialogContent className="border-destructive/30 bg-card">
              <DialogHeader>
                <DialogTitle className="text-destructive flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5" /> Confirm Node Removal
                </DialogTitle>
                <DialogDescription className="text-muted-foreground pt-4">
                  Are you sure you want to permanently remove <strong>{node.name}</strong> from the federation? This action cannot be undone and will orphan {node.siteCount} hosted sites.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={() => deleteMutation.mutate({ id: node.id })} disabled={deleteMutation.isPending}>
                  {deleteMutation.isPending ? "Removing..." : "Yes, Remove Node"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Details */}
        <div className="space-y-6 lg:col-span-1">
          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg">Capacity & Telemetry</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <div className="flex justify-between text-sm mb-2 font-mono">
                  <span className="text-muted-foreground flex items-center gap-2"><HardDrive className="w-4 h-4" /> Storage Allocation</span>
                  <span className="text-white">{usedStorage.toFixed(1)} GB / {formatGb(node.storageCapacityGb)}</span>
                </div>
                <Progress value={storagePercent} className="h-2 bg-white/5" />
              </div>
              
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Bandwidth Limit</p>
                  <p className="font-mono text-lg text-white">{formatGb(node.bandwidthCapacityGb)}/mo</p>
                </div>
                <div className="bg-black/20 p-3 rounded-lg border border-white/5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Network Uptime</p>
                  <p className="font-mono text-lg text-status-active">{formatPercent(node.uptimePercent)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-lg">Operator Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center border border-secondary/30">
                  <User className="w-5 h-5 text-secondary" />
                </div>
                <div>
                  <p className="font-medium text-white text-sm">{node.operatorName}</p>
                  <p className="text-xs text-muted-foreground font-mono">{node.operatorEmail}</p>
                </div>
              </div>
              {node.publicKey && (
                <div className="pt-4 border-t border-white/5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Public Key
                  </p>
                  <div className="bg-black/30 p-2 rounded font-mono text-[10px] text-primary/70 break-all border border-primary/10">
                    {node.publicKey}
                  </div>
                </div>
              )}
              <div className="pt-4 border-t border-white/5 text-xs font-mono text-muted-foreground flex flex-col gap-2">
                <div className="flex justify-between">
                  <span>Joined:</span>
                  <span className="text-white/70">{format(new Date(node.joinedAt), "MMM d, yyyy HH:mm")}</span>
                </div>
                {node.lastSeenAt && (
                  <div className="flex justify-between">
                    <span>Last Seen:</span>
                    <span className="text-white/70">{format(new Date(node.lastSeenAt), "MMM d, yyyy HH:mm")}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Hosted Sites */}
        <div className="lg:col-span-2">
          <Card className="glass-panel h-full flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Hosted Sites ({nodeSites.length})</CardTitle>
              <Link href={`/sites?node=${node.id}`}>
                <Button variant="outline" size="sm" className="h-8 border-white/10">View All Sites</Button>
              </Link>
            </CardHeader>
            <CardContent className="flex-1">
              {nodeSites.length > 0 ? (
                <div className="space-y-3">
                  {nodeSites.map(site => (
                    <Link key={site.id} href={`/sites/${site.id}`}>
                      <div className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:border-secondary/30 transition-all cursor-pointer gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center border border-secondary/20 group-hover:bg-secondary/20 transition-colors">
                            <Globe className="w-5 h-5 text-secondary" />
                          </div>
                          <div>
                            <h4 className="font-bold text-white group-hover:text-secondary transition-colors">{site.name}</h4>
                            <p className="text-xs text-muted-foreground font-mono">{site.domain}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Storage</span>
                            <span className="font-mono text-white/80">{formatBytes(site.storageUsedMb * 1024 * 1024)}</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Type</span>
                            <Badge variant="outline" className="text-[10px] py-0 h-4 border-white/20 capitalize">{site.siteType}</Badge>
                          </div>
                          <StatusBadge status={site.status} className="h-6" />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center py-12 border border-dashed border-white/10 rounded-xl bg-black/10">
                  <Globe className="w-12 h-12 text-muted-foreground opacity-30 mb-4" />
                  <p className="text-white font-medium mb-1">No sites hosted yet</p>
                  <p className="text-sm text-muted-foreground max-w-sm">This node is connected to the federation but has not been assigned any sites.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
