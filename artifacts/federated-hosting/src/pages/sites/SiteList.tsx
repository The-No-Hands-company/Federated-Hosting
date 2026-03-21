import { useState } from "react";
import { useSites } from "@/lib/apiHooks";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Plus, Globe, Database, Copy, MapPin } from "lucide-react";
import { LoadingState, ErrorState, StatusBadge } from "@/components/shared";
import { Link } from "wouter";
import { formatBytes, formatGb } from "@/lib/utils";
import { SiteForm } from "@/components/forms/SiteForm";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";

export default function SiteList() {
  const { data: sites, isLoading, error } = useSites();
  const [search, setSearch] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error || !sites) return <ErrorState message="Failed to load sites." />;

  const filteredSites = sites.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.domain.toLowerCase().includes(search.toLowerCase()) ||
    s.ownerName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Hosted Sites</h1>
          <p className="text-muted-foreground font-mono text-sm">Managing {sites.length} decentralized properties.</p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-lg shadow-secondary/20">
              <Plus className="w-4 h-4 mr-2" />
              Deploy Site
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] border-white/10 bg-card">
            <DialogHeader>
              <DialogTitle className="font-display text-2xl">Deploy New Site</DialogTitle>
            </DialogHeader>
            <SiteForm onSuccess={() => setIsDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search by domain, name, or owner..." 
          className="pl-10 bg-card/50 border-white/10 focus-visible:ring-secondary"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredSites.map((site, i) => (
          <motion.div key={site.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Link href={`/sites/${site.id}`}>
              <Card className="glass-panel hover:border-secondary/50 transition-all duration-300 cursor-pointer h-full group hover:shadow-secondary/10">
                <CardContent className="p-5 flex flex-col h-full relative">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-br from-secondary/10 to-transparent rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-10 h-10 rounded-lg bg-secondary/10 flex items-center justify-center border border-secondary/20 group-hover:bg-secondary/20 transition-colors">
                      <Globe className="w-5 h-5 text-secondary" />
                    </div>
                    <StatusBadge status={site.status} />
                  </div>
                  
                  <div className="mb-4">
                    <h3 className="font-bold text-lg text-white group-hover:text-secondary transition-colors leading-tight truncate" title={site.name}>{site.name}</h3>
                    <p className="text-sm text-primary font-mono mt-1 truncate" title={site.domain}>{site.domain}</p>
                  </div>
                  
                  <div className="mt-auto space-y-3 pt-4 border-t border-white/5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground uppercase tracking-widest font-bold">Type</span>
                      <Badge variant="outline" className="border-white/20 capitalize font-normal py-0 h-5 bg-black/20 text-white/80">{site.siteType}</Badge>
                    </div>
                    
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground uppercase tracking-widest font-bold">Node</span>
                      <span className="font-mono text-white/80 truncate max-w-[120px]" title={site.primaryNodeDomain || "Unassigned"}>
                        {site.primaryNodeDomain || <span className="text-muted-foreground italic">Unassigned</span>}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground uppercase tracking-widest font-bold">Storage</span>
                      <span className="font-mono text-white/80">{formatBytes(site.storageUsedMb * 1024 * 1024)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>

      {filteredSites.length === 0 && (
        <div className="text-center py-20 bg-card/30 rounded-2xl border border-dashed border-white/10">
          <Globe className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-white mb-1">No sites found</h3>
          <p className="text-muted-foreground text-sm">Try adjusting your search query.</p>
        </div>
      )}
    </div>
  );
}
