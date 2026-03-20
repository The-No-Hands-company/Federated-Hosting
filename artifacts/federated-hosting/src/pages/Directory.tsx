import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, ExternalLink, Search, Upload, BarChart2, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState } from "@/components/shared";
import { motion } from "framer-motion";

const TYPE_COLOR: Record<string, string> = {
  static:    "bg-blue-500/10 text-blue-400 border-blue-500/20",
  dynamic:   "bg-violet-500/10 text-violet-400 border-violet-500/20",
  blog:      "bg-amber-500/10 text-amber-400 border-amber-500/20",
  portfolio: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  other:     "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PAGE_SIZE = 24;

interface Site {
  id: number; name: string; domain: string; description: string | null;
  siteType: string; status: string; ownerName: string; hitCount: number;
}

export default function Directory() {
  const [search, setSearch]       = useState("");
  const [debouncedSearch, setDS]  = useState("");
  const [page, setPage]           = useState(1);

  // Debounce search input — avoids a query on every keystroke
  useEffect(() => {
    const t = setTimeout(() => { setDS(search); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, error } = useQuery<{ data: Site[]; meta: { total: number } }>({
    queryKey: ["directory", debouncedSearch, page],
    queryFn: async () => {
      const qs = new URLSearchParams({
        status: "active", limit: String(PAGE_SIZE), page: String(page),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      const r = await fetch(`${BASE}/api/sites?${qs}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const sites     = data?.data ?? [];
  const total     = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (error) return <ErrorState message="Failed to load sites directory." />;

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-2">
          Sites Directory
        </h1>
        <p className="text-muted-foreground font-mono">
          All active sites hosted on the federation network.
        </p>
      </div>

      {/* Search bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, domain, or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-card/50 border-white/10 focus:border-primary/40 font-mono text-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <Globe className="w-14 h-14 text-muted-foreground/30" />
          <div>
            <p className="text-white font-medium">
              {search ? "No sites match your search" : "No sites yet"}
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              {search
                ? "Try a different search term."
                : "Register and deploy the first site on this federation."}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {sites.map((site, i) => {
            const hitCount = (site as unknown as { hitCount?: number }).hitCount ?? 0;
            return (
              <motion.div
                key={site.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Card className="glass-panel group hover:border-primary/30 transition-all duration-300 h-full flex flex-col">
                  <CardContent className="flex flex-col gap-4 pt-5 flex-1">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                        <Globe className="w-5 h-5 text-primary" />
                      </div>
                      <Badge
                        variant="outline"
                        className={`capitalize text-xs shrink-0 ${TYPE_COLOR[site.siteType] ?? TYPE_COLOR.other}`}
                      >
                        {site.siteType}
                      </Badge>
                    </div>

                    {/* Site info */}
                    <div className="flex-1">
                      <h3 className="font-semibold text-white text-base leading-tight mb-1 group-hover:text-primary transition-colors">
                        {site.name}
                      </h3>
                      <p className="text-primary/80 font-mono text-xs truncate mb-2">{site.domain}</p>
                      {site.description && (
                        <p className="text-muted-foreground text-sm line-clamp-2">{site.description}</p>
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono border-t border-white/5 pt-3">
                      <span className="flex items-center gap-1.5">
                        <Upload className="w-3 h-3" />
                        {site.storageUsedMb.toFixed(1)} MB
                      </span>
                      {hitCount > 0 && (
                        <span className="flex items-center gap-1.5">
                          <BarChart2 className="w-3 h-3" />
                          {hitCount.toLocaleString()} hits
                        </span>
                      )}
                      <span className="ml-auto text-muted-foreground/50">{site.ownerName}</span>
                    </div>

                    {/* Action button */}
                    <a
                      href={`${BASE}/api/sites/serve/${site.domain}/index.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button
                        size="sm"
                        className="w-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 font-mono text-xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        Visit Site
                      </Button>
                    </a>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Footer count + pagination */}
      {!isLoading && sites.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground font-mono">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} site{total !== 1 ? "s" : ""}
          </p>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="border-white/10 h-8 px-2" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-xs text-muted-foreground font-mono">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" className="border-white/10 h-8 px-2" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
