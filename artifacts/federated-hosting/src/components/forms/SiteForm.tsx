import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSite, useUpdateSite } from "@workspace/api-client-react";
import { useNodes } from "@/lib/apiHooks";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { getListSitesQueryKey } from "@workspace/api-client-react";
import { CreateSiteBodySiteType } from "@workspace/api-client-react";

const siteSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  domain: z.string().min(3, "Domain is required."),
  description: z.string().optional(),
  siteType: z.nativeEnum(CreateSiteBodySiteType),
  ownerName: z.string().min(2, "Owner name is required."),
  ownerEmail: z.string().email("Must be a valid email."),
  primaryNodeId: z.coerce.number().optional(),
});

type SiteFormValues = z.infer<typeof siteSchema>;

interface SiteFormProps {
  onSuccess?: () => void;
  initialData?: SiteFormValues & { id?: number };
}

export function SiteForm({ onSuccess, initialData }: SiteFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: nodes } = useNodes();
  
  const form = useForm<SiteFormValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: initialData || {
      name: "",
      domain: "",
      description: "",
      siteType: "static",
      ownerName: "",
      ownerEmail: "",
      primaryNodeId: undefined,
    },
  });

  const createMutation = useCreateSite({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        toast({ title: "Site Registered", description: "Site is provisioning on the federation." });
        onSuccess?.();
      },
      onError: (error) => {
        toast({ title: "Registration Failed", description: String(error), variant: "destructive" });
      }
    }
  });

  const updateMutation = useUpdateSite({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
        toast({ title: "Site Updated", description: "Site configuration saved." });
        onSuccess?.();
      },
      onError: (error) => {
        toast({ title: "Update Failed", description: String(error), variant: "destructive" });
      }
    }
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(data: SiteFormValues) {
    if (initialData?.id) {
      updateMutation.mutate({ id: initialData.id, data });
    } else {
      createMutation.mutate({ data });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Site Name</FormLabel>
                <FormControl><Input placeholder="My Cool Blog" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="domain"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Domain</FormLabel>
                <FormControl><Input placeholder="example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="ownerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Owner Name</FormLabel>
                <FormControl><Input placeholder="Alice Smith" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ownerEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Owner Email</FormLabel>
                <FormControl><Input type="email" placeholder="alice@example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="siteType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Site Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="static">Static (HTML/CSS/JS)</SelectItem>
                    <SelectItem value="nlpl">NLPL Application</SelectItem>
                    <SelectItem value="dynamic">Node.js Application</SelectItem>
                    <SelectItem value="blog">Blog</SelectItem>
                    <SelectItem value="portfolio">Portfolio</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={form.control}
            name="primaryNodeId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target Node (Optional)</FormLabel>
                <Select 
                  onValueChange={(val) => field.onChange(val === "auto" ? undefined : parseInt(val))} 
                  defaultValue={field.value ? String(field.value) : "auto"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-assign" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="auto">Auto-assign (Recommended)</SelectItem>
                    {nodes?.map(node => (
                      <SelectItem key={node.id} value={String(node.id)}>
                        {node.name} ({node.region})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end pt-4">
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto min-w-[150px]">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initialData?.id ? "Update Configuration" : "Deploy Site"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
