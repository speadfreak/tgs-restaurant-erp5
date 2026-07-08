import { useState } from "react";
import { useListCustomers } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Edit, Phone, MapPin, ShoppingBag, Star, Users } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/api-base";

const BASE = getApiBase();
function getToken() { return localStorage.getItem("tg_erp_token"); }

async function patchCustomer(id: number, data: { name?: string; phone?: string; address?: string }) {
  const res = await fetch(`${BASE}/api/customers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

async function createCustomer(data: { name: string; phone: string; address?: string }) {
  const res = await fetch(`${BASE}/api/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const EMPTY_FORM = { name: "", phone: "", address: "" };

export default function Customers() {
  const [search, setSearch] = useState("");
  const { data: customers, isLoading } = useListCustomers({ search });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editId, setEditId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const openEdit = (c: { id: number; name: string; phone: string; address?: string | null }) => {
    setForm({ name: c.name, phone: c.phone, address: c.address ?? "" });
    setEditId(c.id);
  };

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setAddOpen(true);
  };

  const closeDialogs = () => { setEditId(null); setAddOpen(false); };

  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      toast({ title: "Name and phone are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editId != null) {
        await patchCustomer(editId, { name: form.name, phone: form.phone, address: form.address || undefined });
        toast({ title: "Customer updated" });
      } else {
        await createCustomer({ name: form.name, phone: form.phone, address: form.address || undefined });
        toast({ title: "Customer added" });
      }
      await queryClient.invalidateQueries();
      closeDialogs();
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    }
    setSaving(false);
  };

  const topSpenders = [...(customers ?? [])].sort((a, b) => (b.totalSpent ?? 0) - (a.totalSpent ?? 0)).slice(0, 3);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Users className="h-8 w-8 text-primary" />Customers
          </h1>
          <p className="text-muted-foreground mt-1">WhatsApp customer profiles and order history.</p>
        </div>
        <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Add Customer</Button>
      </div>

      {/* Top spenders strip */}
      {topSpenders.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {topSpenders.map((c, i) => (
            <div key={c.id} className="rounded-xl border p-4 flex items-center gap-3" style={{ background: "hsl(var(--card))" }}>
              <div className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-black ${i === 0 ? "bg-amber-500/20 text-amber-400" : "bg-zinc-700/30 text-zinc-400"}`}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.totalOrders ?? 0} orders · <span className="text-primary font-semibold">{c.totalSpent ?? 0} AED</span></div>
              </div>
              {i === 0 && <Star className="h-4 w-4 text-amber-400 flex-shrink-0" />}
            </div>
          ))}
        </div>
      )}

      {/* Main table */}
      <Card>
        <CardHeader className="pb-4 flex flex-row justify-between items-center">
          <CardTitle>Customer Directory ({customers?.length ?? 0})</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Total Spent</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading customers...</TableCell></TableRow>
              ) : !customers?.length ? (
                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="h-8 w-8 opacity-30" />
                    <p>No customers yet. They appear automatically when WhatsApp orders come in.</p>
                  </div>
                </TableCell></TableRow>
              ) : customers.map((c) => (
                <TableRow key={c.id} className="group">
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <a href={`tel:${c.phone}`} className="flex items-center gap-1.5 text-blue-500 hover:underline text-sm">
                      <Phone className="h-3 w-3" />{c.phone}
                    </a>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {c.address ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate max-w-[160px]">{c.address}</span>
                      </span>
                    ) : <span className="text-zinc-600 italic text-xs">No address</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                      <ShoppingBag className="h-3 w-3" />{c.totalOrders || 0}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-primary font-semibold">{c.totalSpent ?? 0} AED</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{format(new Date(c.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => openEdit(c)}>
                      <Edit className="h-3.5 w-3.5 mr-1.5" />Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit / Add Dialog */}
      <Dialog open={editId != null || addOpen} onOpenChange={(open) => { if (!open) closeDialogs(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editId != null ? "Edit Customer" : "Add Customer"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Tigist Haile" />
            </div>
            <div className="space-y-2">
              <Label>WhatsApp Phone *</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+971 50 123 4567" />
            </div>
            <div className="space-y-2">
              <Label>Delivery Address</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Building, Street, Area — Dubai" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialogs}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.phone.trim()}>
              {saving ? "Saving..." : editId != null ? "Save Changes" : "Add Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
