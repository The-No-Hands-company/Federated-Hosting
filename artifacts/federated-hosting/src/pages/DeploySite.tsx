import { useState, useCallback, useRef } from "react";
import { useParams, Link } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileIcon, Rocket, CheckCircle, Clock, ArrowLeft,
  Globe, ExternalLink, AlertCircle, Loader2, FolderOpen, Trash2,
  RotateCcw, Eye, ChevronDown, ChevronRight, BarChart2,
  FileText, Image, Code, Package,
} from "lucide-react";import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { SitePreviewModal } from "@/components/SitePreviewModal";
import { NlplPanel } from "@/components/NlplPanel";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html", htm: "text/html", css: "text/css",
  js: "application/javascript", mjs: "application/javascript",
  json: "application/json", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml",
  webp: "image/webp", ico: "image/x-icon", woff: "font/woff",
  woff2: "font/woff2", ttf: "font/ttf", txt: "text/plain",
  xml: "application/xml", pdf: "application/pdf",
};

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileIcon(path: string): React.ElementType {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["html","htm"].includes(ext)) return FileText;
  if (["png","jpg","jpeg","gif","svg","webp","ico"].includes(ext)) return Image;
  if (["js","mjs","ts","css","json","xml"].includes(ext)) return Code;
  return Package;
}

interface UploadItem {
  file: File; filePath: string;
  status: "pending"|"uploading"|"done"|"error";
  progress: number; error?: string;
}
interface SiteFile { id:number; siteId:number; deploymentId:number|null; filePath:string; contentType:string; sizeBytes:number; createdAt:string; }
interface Deployment { id:number; siteId:number; version:number; status:string; fileCount:number; totalSizeMb:number; deployedAt:string; deployedBy:string|null; createdAt:string; }
interface Site { id:number; name:string; domain:string; status:string; hitCount:number; storageUsedMb:number; }

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, { credentials:"include", ...init });
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as {message?:string;error?:string};
    throw new Error(body.message ?? body.error ?? `HTTP ${r.status}`);
  }
  if (r.status === 204) return undefined as T;
  return r.json();
}

function PreviewPanel({ files, queue }: { files: SiteFile[]; queue: UploadItem[] }) {
  const [open, setOpen] = useState(true);
  const pendingFromQueue = queue.filter(q => q.status !== "error");
  const allFiles = [
    ...files.map(f => ({ name:f.filePath, size:f.sizeBytes, live:!!f.deploymentId, queued:false })),
    ...pendingFromQueue.filter(q => !files.find(f => f.filePath === q.filePath))
      .map(q => ({ name:q.filePath, size:q.file.size, live:false, queued:true })),
  ];
  const totalBytes = allFiles.reduce((s,f) => s+f.size, 0);
  const hasIndex = allFiles.some(f => f.name === "index.html");
  if (allFiles.length === 0) return null;
  return (
    <Card className="border-white/5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-white/2 transition-colors rounded-t-xl">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2 text-base">
                <Eye className="w-4 h-4 text-primary"/>
                Site Preview
                <Badge variant="outline" className="border-white/10 text-muted-foreground font-mono text-xs">{allFiles.length} files</Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">{formatBytes(totalBytes)}</span>
                {open ? <ChevronDown className="w-4 h-4 text-muted-foreground"/> : <ChevronRight className="w-4 h-4 text-muted-foreground"/>}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {!hasIndex && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5 text-amber-300 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0"/>
                <span>No <code className="font-mono">index.html</code> — site may not load correctly.</span>
              </div>
            )}
            <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
              {allFiles.map(f => {
                const Icon = fileIcon(f.name);
                return (
                  <div key={f.name} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-white/3 group">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0"/>
                    <span className="flex-1 text-xs font-mono text-muted-foreground truncate group-hover:text-white transition-colors">{f.name}</span>
                    <span className="text-xs text-muted-foreground/60 shrink-0">{formatBytes(f.size)}</span>
                    {f.queued ? (
                      <Badge variant="outline" className="text-[10px] border-amber-400/30 text-amber-400 h-4 px-1">queued</Badge>
                    ) : f.live ? (
                      <Badge variant="outline" className="text-[10px] border-status-active/30 text-status-active h-4 px-1">live</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-amber-400/30 text-amber-400 h-4 px-1">pending</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function DeploymentHistory({ siteId, deployments, onRollback, isRollingBack, rollingBackId }: {
  siteId:number; deployments:Deployment[];
  onRollback:(depId:number)=>void; isRollingBack:boolean; rollingBackId:number|null;
}) {
  const STATUS_STYLE: Record<string,string> = {
    active:"border-status-active/30 text-status-active",
    pending:"border-amber-400/30 text-amber-400",
    rolled_back:"border-white/10 text-muted-foreground",
    failed:"border-red-400/30 text-red-400",
  };
  const sorted = [...deployments].sort((a,b) => b.version - a.version);
  return (
    <Card className="border-white/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-white flex items-center gap-2 text-base">
          <Rocket className="w-4 h-4 text-primary"/>{t("deploy.history.title")}
        </CardTitle>
        <CardDescription>{deployments.length} deployment{deployments.length!==1?"s":""}</CardDescription>
      </CardHeader>
      <CardContent>
        {deployments.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">{t("deploy.history.noDeployments")}</p>
        ) : (
          <div className="space-y-2">
            {sorted.map(d => {
              const isActive = d.status === "active";
              const canRollback = !isActive && d.status !== "failed" && d.fileCount > 0;
              const isThisOne = rollingBackId === d.id;
              return (
                <div key={d.id} className={cn("rounded-xl border p-3 transition-colors", isActive ? "border-status-active/20 bg-status-active/5" : "border-white/5")}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-white font-mono font-semibold text-sm">v{d.version}</span>
                      <Badge variant="outline" className={cn("text-xs", STATUS_STYLE[d.status] ?? "border-white/10 text-muted-foreground")}>
                        {d.status.replace("_"," ")}
                      </Badge>
                    </div>
                    {canRollback && (
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-white"
                        onClick={() => onRollback(d.id)} disabled={isRollingBack}>
                        {isThisOne && isRollingBack ? <Loader2 className="w-3 h-3 mr-1 animate-spin"/> : <RotateCcw className="w-3 h-3 mr-1"/>}
                        Rollback
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                    <span>{d.fileCount} files · {d.totalSizeMb.toFixed(2)} MB{d.environment && d.environment !== "production" ? <span className="ml-1 text-amber-400">({d.environment})</span> : null}</span>
                    <span className="flex items-center justify-between">
                      <span>{d.deployedBy?.startsWith("federation:") ? <span className="text-secondary">↙ replicated</span> : formatDistanceToNow(new Date(d.deployedAt),{addSuffix:true})}</span>
                      {d.version > 1 && (
                        <a href={`${import.meta.env.BASE_URL?.replace(/\/$/,"")}/api/sites/${siteId}/deployments/${d.id}/diff`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors"
                          title="View diff vs previous version">
                          diff
                        </a>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DeploySite() {
  const { id } = useParams<{id:string}>();
  const siteId = parseInt(id,10);
  const { isAuthenticated, login } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data:site, isLoading:siteLoading } = useQuery<Site>({ queryKey:["site",siteId], queryFn:()=>apiFetch(`/sites/${siteId}`) });
  const { data:files=[], refetch:refetchFiles } = useQuery<SiteFile[]>({ queryKey:["site-files",siteId], queryFn:()=>apiFetch(`/sites/${siteId}/files`), enabled:isAuthenticated });
  const { data:deployments=[], refetch:refetchDeployments } = useQuery<Deployment[]>({ queryKey:["site-deployments",siteId], queryFn:()=>apiFetch(`/sites/${siteId}/deployments`), enabled:isAuthenticated });

  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [environment, setEnvironment] = useState<"production" | "staging">("production");
  const [rollingBackId, setRollingBackId] = useState<number|null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { t } = useTranslation();
  const rollbackMutation = useMutation({
    mutationFn:(depId:number) => apiFetch(`/sites/${siteId}/deployments/${depId}/rollback`,{method:"POST"}),
    onMutate:(depId) => setRollingBackId(depId),
    onSuccess:() => {
      qc.invalidateQueries({queryKey:["site-deployments",siteId]});
      qc.invalidateQueries({queryKey:["site-files",siteId]});
      setRollingBackId(null);
      toast({title:"Rolled back!",description:"Site is now serving the previous version."});
    },
    onError:(err:Error) => { setRollingBackId(null); toast({title:"Rollback failed",description:err.message,variant:"destructive"}); },
  });

  const addFiles = useCallback((newFiles:FileList|File[]) => {
    const items:UploadItem[] = Array.from(newFiles).map(f => ({file:f,filePath:f.name,status:"pending" as const,progress:0}));
    setUploadQueue(prev => [...prev,...items]);
  },[]);

  const updateItem = (index:number,patch:Partial<UploadItem>) =>
    setUploadQueue(prev => prev.map((item,i) => i===index?{...item,...patch}:item));

  const uploadAll = async () => {
    if (!isAuthenticated) { login(); return; }
    for (let i=0; i<uploadQueue.length; i++) {
      const item = uploadQueue[i];
      if (item.status !== "pending") continue;
      updateItem(i,{status:"uploading",progress:10});
      try {
        const ct = getContentType(item.file.name);
        const {uploadUrl,objectPath} = await apiFetch<{uploadUrl:string;objectPath:string}>(
          `/sites/${siteId}/files/upload-url`,
          {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filePath:item.filePath,contentType:ct,size:item.file.size})}
        );
        updateItem(i,{progress:35});
        await fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":ct},body:item.file});
        updateItem(i,{progress:70});
        await apiFetch(`/sites/${siteId}/files`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filePath:item.filePath,objectPath,contentType:ct,sizeBytes:item.file.size})});
        updateItem(i,{status:"done",progress:100});
      } catch(err:any) { updateItem(i,{status:"error",error:err.message}); }
    }
    await refetchFiles();
    toast({title:"Files uploaded",description:"Ready to deploy!"});
  };

  const deploy = async () => {
    if (!isAuthenticated) { login(); return; }
    setIsDeploying(true);
    try {
      const result = await apiFetch<{replication?:{peers:number;synced:number}}>(`/sites/${siteId}/deploy`,{
        method:"POST",
        body: JSON.stringify({ environment }),
      });
      await Promise.all([refetchFiles(),refetchDeployments()]);
      setUploadQueue([]);
      const rep = result.replication;
      const repMsg = rep&&rep.peers>0?` Replicated to ${rep.synced}/${rep.peers} peers.`:"";
      const envLabel = environment === "staging" ? " (staging)" : "";
      toast({title:"Deployed!",description:`Your site is now live${envLabel}.${repMsg}`});
    } catch(err:any) {
      toast({title:"Deploy failed",description:err.message,variant:"destructive"});
    } finally { setIsDeploying(false); }
  };

  if (!isAuthenticated) return (
    <div className="flex flex-col items-center justify-center py-24 gap-6">
      <AlertCircle className="w-12 h-12 text-muted-foreground"/>
      <div className="text-center"><h2 className="text-2xl font-bold text-white mb-2">Authentication Required</h2><p className="text-muted-foreground">Sign in to deploy files.</p></div>
      <Button onClick={login} className="bg-primary text-black hover:bg-primary/90 font-semibold">Sign In</Button>
    </div>
  );

  if (siteLoading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary"/></div>;
  if (!site) return <div className="text-center py-24"><p className="text-muted-foreground">Site not found.</p><Link href="/my-sites"><Button variant="link" className="text-primary mt-2">Back to My Sites</Button></Link></div>;

  const pendingCount = uploadQueue.filter(i=>i.status==="pending").length;
  const doneCount    = uploadQueue.filter(i=>i.status==="done").length;
  const hasUndeployed = files.length>0||doneCount>0;
  const activeDeployment = deployments.find(d=>d.status==="active");

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/my-sites"><Button variant="ghost" size="icon" className="text-muted-foreground hover:text-white"><ArrowLeft className="w-5 h-5"/></Button></Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold text-white tracking-tight truncate">{site.name}</h1>
          <p className="text-primary font-mono text-sm mt-0.5">{site.domain}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/analytics/${siteId}`}><Button variant="outline" size="sm" className="border-white/10 text-muted-foreground hover:text-white"><BarChart2 className="w-4 h-4 mr-1.5"/>{t("common.analytics")}</Button></Link>
          {activeDeployment && <a href={`/api/sites/serve/${site.domain}/index.html`} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm" className="border-status-active/30 text-status-active hover:bg-status-active/10"><ExternalLink className="w-4 h-4 mr-1.5"/>{t("common.viewLive")}</Button></a>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <Card className="border-white/5">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2"><Upload className="w-5 h-5 text-primary"/>{t("deploy.title")}</CardTitle>
              <CardDescription>Drop HTML, CSS, JS, images and other assets. Files upload directly to object storage.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={cn("border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer",isDragOver?"border-primary bg-primary/5 shadow-[0_0_20px_rgba(0,229,255,0.1)]":"border-white/10 hover:border-white/20")}
                onDragOver={e=>{e.preventDefault();setIsDragOver(true);}} onDragLeave={()=>setIsDragOver(false)}
                onDrop={e=>{e.preventDefault();setIsDragOver(false);if(e.dataTransfer.files.length>0)addFiles(e.dataTransfer.files);}}
                onClick={()=>fileInputRef.current?.click()}>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e=>e.target.files&&addFiles(e.target.files)}/>
                <FolderOpen className={cn("w-12 h-12 mx-auto mb-3 transition-colors",isDragOver?"text-primary":"text-muted-foreground")}/>
                <p className="text-white font-medium mb-1">{t("deploy.dropzone")}</p>
                <p className="text-muted-foreground text-sm">HTML, CSS, JS, images, fonts · 50 MB per file</p>
              </div>

              <AnimatePresence>
                {uploadQueue.length>0&&(
                  <motion.div initial={{opacity:0}} animate={{opacity:1}} className="space-y-2">
                    {uploadQueue.map((item,i)=>{
                      const Icon=fileIcon(item.filePath);
                      return (
                        <div key={i} className="bg-muted/20 rounded-lg p-3 flex items-center gap-3">
                          <Icon className="w-4 h-4 text-muted-foreground shrink-0"/>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate font-mono">{item.filePath}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</p>
                            {item.status==="uploading"&&<Progress value={item.progress} className="h-1 mt-1.5"/>}
                            {item.error&&<p className="text-xs text-red-400 mt-0.5">{item.error}</p>}
                          </div>
                          <div className="shrink-0">
                            {item.status==="pending"&&<Clock className="w-4 h-4 text-muted-foreground"/>}
                            {item.status==="uploading"&&<Loader2 className="w-4 h-4 text-primary animate-spin"/>}
                            {item.status==="done"&&<CheckCircle className="w-4 h-4 text-status-active"/>}
                            {item.status==="error"&&<AlertCircle className="w-4 h-4 text-red-400"/>}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex gap-2 pt-1">
                      {pendingCount>0&&<Button onClick={uploadAll} className="flex-1 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"><Upload className="w-4 h-4 mr-2"/>Upload {pendingCount} File{pendingCount!==1?"s":""}</Button>}
                      <Button variant="ghost" onClick={()=>setUploadQueue([])} className="text-muted-foreground hover:text-white"><Trash2 className="w-4 h-4 mr-1.5"/>Clear</Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {hasUndeployed&&uploadQueue.every(i=>i.status!=="pending")&&(
                <motion.div initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}>
                  <div className="flex gap-2 mb-2">
                    {(["production", "staging"] as const).map(env => (
                      <button key={env} onClick={() => setEnvironment(env)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold border transition-all ${
                          environment === env
                            ? env === "production" ? "bg-primary/15 border-primary/40 text-primary" : "bg-amber-400/15 border-amber-400/40 text-amber-400"
                            : "border-white/5 text-muted-foreground hover:border-white/15"
                        }`}>
                        {env.charAt(0).toUpperCase() + env.slice(1)}
                      </button>
                    ))}
                  </div>
                  <Button onClick={deploy} disabled={isDeploying} className="w-full bg-primary text-black hover:bg-primary/90 font-semibold shadow-lg shadow-primary/20 h-11">
                    {isDeploying?<><Loader2 className="w-4 h-4 mr-2 animate-spin"/>{t("deploy.deploying")}</>:<><Rocket className="w-4 h-4 mr-2"/>{t("deploy.deploySite")}</>}
                  </Button>
                </motion.div>
              )}
            </CardContent>
          </Card>

          <PreviewPanel files={files} queue={uploadQueue}/>
        </div>

        <div className="space-y-4">
          {/* NLPL / dynamic site process management panel */}
          {(site.siteType === "nlpl" || site.siteType === "dynamic") && (
            <NlplPanel siteId={siteId} siteDomain={site.domain} siteType={site.siteType} />
          )}

          <DeploymentHistory siteId={siteId} deployments={deployments} onRollback={depId=>rollbackMutation.mutate(depId)} isRollingBack={rollbackMutation.isPending} rollingBackId={rollingBackId}/>
          <Card className="border-white/5">
            <CardHeader className="pb-3"><CardTitle className="text-white text-base">Quick Links</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {files.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}
                  className="w-full border-primary/30 text-primary hover:bg-primary/10 justify-start">
                  <Eye className="w-3.5 h-3.5 mr-2"/>Preview Site
                </Button>
              )}
              <a href={`/api/sites/serve/${site.domain}/index.html`} target="_blank" rel="noopener noreferrer" className="block">
                <Button size="sm" variant="outline" className="w-full border-white/10 text-muted-foreground hover:text-white justify-start"><Globe className="w-3.5 h-3.5 mr-2"/>Live Site</Button>
              </a>
              <Link href={`/analytics/${siteId}`} className="block">
                <Button size="sm" variant="outline" className="w-full border-white/10 text-muted-foreground hover:text-white justify-start"><BarChart2 className="w-3.5 h-3.5 mr-2"/>{t("common.analytics")}</Button>
              </Link>
              <div className="bg-muted/20 rounded-xl p-3 mt-1">
                <p className="text-xs text-muted-foreground mb-1.5">CLI deploy:</p>
                <code className="font-mono text-xs text-primary break-all">fh deploy ./dist --site {siteId}</code>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <SitePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        siteDomain={site.domain}
        siteId={siteId}
      />
}
