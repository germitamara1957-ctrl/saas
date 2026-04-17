import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useListUsers, useCreateUser, useCreateApiKey, useListPlans, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Search, Plus, Copy, Check, ChevronRight } from "lucide-react";
import { format } from "date-fns";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  planId: z.string().min(1),
});

export default function AdminDevelopers() {
  const [search, setSearch] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: usersData, isLoading, isError } = useListUsers({ search: debouncedSearch, limit: 50 });
  const { data: plans } = useListPlans();
  
  const createUser = useCreateUser();
  const createApiKey = useCreateApiKey();

  const form = useForm<z.infer<typeof createUserSchema>>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { email: "", name: "", password: "", planId: "" },
  });

  const onSubmit = (data: z.infer<typeof createUserSchema>) => {
    createUser.mutate(
      { data: { email: data.email, name: data.name, password: data.password, role: "developer" } },
      {
        onSuccess: (user) => {
          createApiKey.mutate(
            { data: { userId: user.id, planId: parseInt(data.planId), name: "Default Key" } },
            {
              onSuccess: (apiKeyData) => {
                setGeneratedKey(apiKeyData.rawKey);
                queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
                form.reset();
              },
              onError: (err) => {
                toast({ title: "Error creating API key", description: err.message, variant: "destructive" });
              }
            }
          );
        },
        onError: (err) => {
          toast({ title: "Error creating user", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const copyToClipboard = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    }
  };

  const closeDialog = () => {
    setCreateDialogOpen(false);
    setGeneratedKey(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Developers</h1>
        <Button onClick={() => setCreateDialogOpen(true)} data-testid="button-create-developer">
          <Plus className="mr-2 h-4 w-4" /> Add Developer
        </Button>
      </div>

      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by email or name..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-developers"
          />
        </div>
      </div>

      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right" title="Subscription credit (plan-restricted)">Subscription</TableHead>
              <TableHead className="text-right" title="Top-up credit (works on all models)">Top-up</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">Loading developers...</TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-destructive">Failed to load developers. Please refresh the page.</TableCell>
              </TableRow>
            ) : usersData?.items.filter(u => u.role === "developer").length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No developers found</TableCell>
              </TableRow>
            ) : (
              usersData?.items.filter(u => u.role === "developer").map((user) => (
                <TableRow key={user.id} className="group">
                  <TableCell className="font-medium">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {user.isActive ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/20">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${user.creditBalance.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${((user as unknown as { topupCreditBalance?: number }).topupCreditBalance ?? 0).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(user.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <Link to={`/admin/developers/${user.id}`}>
                      <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                        View Details <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          {generatedKey ? (
            <>
              <DialogHeader>
                <DialogTitle>Developer Created</DialogTitle>
                <DialogDescription>
                  The developer account has been created and an initial API key has been generated.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="p-4 bg-muted rounded-md space-y-2">
                  <Label>API Key</Label>
                  <div className="flex items-center space-x-2">
                    <Input readOnly value={generatedKey} className="font-mono bg-background" />
                    <Button size="icon" variant="outline" onClick={copyToClipboard} data-testid="button-copy-key">
                      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-destructive font-medium mt-2">
                    Please copy this key now. It will not be shown again.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={closeDialog}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Add Developer</DialogTitle>
                <DialogDescription>Create a new developer account and generate their first API key.</DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                      <Label>Full Name</Label>
                      <FormControl><Input placeholder="Jane Doe" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <Label>Email Address</Label>
                      <FormControl><Input type="email" placeholder="jane@example.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                      <Label>Temporary Password</Label>
                      <FormControl><Input type="password" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="planId" render={({ field }) => (
                    <FormItem>
                      <Label>Initial Plan</Label>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a plan" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {plans?.map(plan => (
                            <SelectItem key={plan.id} value={plan.id.toString()}>{plan.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <DialogFooter className="mt-6">
                    <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={createUser.isPending || createApiKey.isPending}>
                      {createUser.isPending || createApiKey.isPending ? "Creating..." : "Create Developer"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
