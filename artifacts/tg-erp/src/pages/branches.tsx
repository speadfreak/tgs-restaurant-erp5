import { useState } from "react";
import { useListBranches, useCreateBranch, useUpdateBranch } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Store, MapPin, Phone, Edit } from "lucide-react";

type Branch = { id: number; name: string; address?: string | null; phone?: string | null; active: boolean };
const EMPTY_FORM = { name: "", address: "", phone: "", active: true };

export default function Branches() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();

  const { data: branches, isLoading } = useListBranches();

  const [dialog, setDialog] = useState<{ open: boolean; editing: Branch | null }>({ open: false, editing: null });
  const [form, setForm] = useState(EMPTY_FORM);

  const createBranch = useCreateBranch({ mutation: { onSuccess: () => { toast({ title: "Branch created" }); invalidate(); setDialog({ open: false, editing: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const updateBranch = useUpdateBranch({ mutation: { onSuccess: () => { toast({ title: "Branch updated" }); invalidate(); setDialog({ open: false, editing: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });

  const openAdd = () => { setForm(EMPTY_FORM); setDialog({ open: true, editing: null }); };
  const openEdit = (b: Branch) => { setForm({ name: b.name, address: b.address ?? "", phone: b.phone ?? "", active: b.active }); setDialog({ open: true, editing: b }); };

  const save = () => {
    const body = { name: form.name, address: form.address || "", phone: form.phone || "", active: form.active };
    if (dialog.editing) updateBranch.mutate({ id: dialog.editing.id, data: body });
    else createBranch.mutate({ data: body });
  };

  const mutating = createBranch.isPending || updateBranch.isPending;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-3">
            <Store className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
            Branches
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage multi-branch locations.</p>
        </div>
        <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Add Branch</Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading branches...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {branches?.map(branch => (
            <Card key={branch.id} className="relative overflow-hidden">
              <div className={`absolute top-0 w-full h-1 ${branch.active ? "bg-green-500" : "bg-red-500"}`} />
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-xl">{branch.name}</CardTitle>
                  <Badge variant={branch.active ? "default" : "secondary"}>{branch.active ? "Active" : "Closed"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {branch.address && (
                  <div className="flex items-start gap-3 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                    <span>{branch.address}</span>
                  </div>
                )}
                {branch.phone && (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0 text-primary" />
                    <span>{branch.phone}</span>
                  </div>
                )}
                <Button variant="outline" className="w-full" onClick={() => openEdit(branch)}>
                  <Edit className="mr-2 h-4 w-4" /> Edit Details
                </Button>
              </CardContent>
            </Card>
          ))}
          <Card
            className="border-dashed border-2 flex flex-col items-center justify-center min-h-[200px] cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onClick={openAdd}
          >
            <Plus className="h-10 w-10 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Add New Branch</p>
          </Card>
        </div>
      )}

      <Dialog open={dialog.open} onOpenChange={open => setDialog(d => ({ ...d, open }))}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog.editing ? "Edit Branch" : "Add Branch"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Branch Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="TG Deira" /></div>
            <div className="space-y-2"><Label>Address</Label><Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Deira, Dubai, UAE" /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+97142001001" /></div>
            <div className="flex items-center gap-3"><Switch checked={form.active} onCheckedChange={v => setForm(f => ({ ...f, active: v }))} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={save} disabled={mutating || !form.name}>{mutating ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
