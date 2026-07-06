import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Package, Plus, CheckCircle2, Truck, Clock, Building2 } from "lucide-react";
import { format } from "date-fns";

interface Supplier { id: number; name: string; phone: string | null; branchId: number }
interface InventoryItem { id: number; name: string; unit: string; quantityOnHand: number; reorderThreshold: number; reorderQuantity: number; preferredSupplierId: number | null; branchId: number }
interface RestockOrder {
  id: number; branchId: number; ingredientId: number; ingredientName: string | null;
  ingredientUnit: string | null; quantity: number; supplierId: number | null;
  supplierName: string | null; supplierPhone: string | null; status: string;
  notes: string | null; approvedAt: string | null; receivedAt: string | null; createdAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function getToken() { return localStorage.getItem("tg_erp_token"); }
async function apiFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
    approved: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    received: "bg-green-500/20 text-green-400 border-green-500/30",
  };
  return <Badge className={map[status] ?? "border-zinc-700 text-zinc-400"}>{status}</Badge>;
}

export default function RestockAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<RestockOrder[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ ingredientId: "", quantity: "", supplierId: "", notes: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (user?.branchId) params.set("branchId", String(user.branchId));
      const [r, i, s] = await Promise.all([
        apiFetch(`/api/restock?${params}`),
        apiFetch(`/api/inventory?${params}`),
        apiFetch(`/api/suppliers?${params}`),
      ]);
      setOrders(r);
      setItems(i);
      setSuppliers(s);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.branchId]);

  useEffect(() => { load(); }, [load]);

  const approve = async (id: number) => {
    setPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/restock/${id}/approve`, "PATCH");
      setOrders(prev => prev.map(r => r.id === id ? { ...r, status: "approved" } : r));
      toast({ title: "Approved", description: "Restock order approved" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    setPending(p => ({ ...p, [id]: false }));
  };

  const receive = async (id: number) => {
    setPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/restock/${id}/receive`, "PATCH");
      setOrders(prev => prev.map(r => r.id === id ? { ...r, status: "received" } : r));
      toast({ title: "Received", description: "Stock updated" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    setPending(p => ({ ...p, [id]: false }));
  };

  const createRestock = async () => {
    if (!newForm.ingredientId || !newForm.quantity) return;
    setCreating(true);
    try {
      const item = items.find(i => i.id === parseInt(newForm.ingredientId));
      await apiFetch("/api/restock", "POST", {
        branchId: item?.branchId ?? user?.branchId,
        ingredientId: parseInt(newForm.ingredientId),
        quantity: parseFloat(newForm.quantity),
        supplierId: newForm.supplierId ? parseInt(newForm.supplierId) : null,
        notes: newForm.notes || null,
      });
      setNewForm({ ingredientId: "", quantity: "", supplierId: "", notes: "" });
      setNewOpen(false);
      load();
      toast({ title: "Restock order created" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    setCreating(false);
  };

  const filtered = statusFilter === "all" ? orders : orders.filter(r => r.status === statusFilter);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Package className="h-7 w-7 text-amber-500" />Restock Requests
          </h1>
          <p className="text-muted-foreground mt-1">Manage inventory replenishment orders</p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button className="bg-amber-500 hover:bg-amber-400 text-black font-bold">
              <Plus className="h-4 w-4 mr-2" />New Request
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-700">
            <DialogHeader><DialogTitle>Create Restock Request</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Ingredient *</Label>
                <Select value={newForm.ingredientId} onValueChange={v => setNewForm(f => ({ ...f, ingredientId: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select ingredient..." /></SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {items.map(i => <SelectItem key={i.id} value={String(i.id)}>{i.name} ({i.quantityOnHand} {i.unit} on hand)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantity to order *</Label>
                <Input type="number" value={newForm.quantity} onChange={e => setNewForm(f => ({ ...f, quantity: e.target.value }))} placeholder="0" className="bg-zinc-800 border-zinc-700" />
              </div>
              <div className="space-y-2">
                <Label>Supplier (optional)</Label>
                <Select value={newForm.supplierId} onValueChange={v => setNewForm(f => ({ ...f, supplierId: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select supplier..." /></SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={newForm.notes} onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." className="bg-zinc-800 border-zinc-700" />
              </div>
              <Button onClick={createRestock} disabled={creating || !newForm.ingredientId || !newForm.quantity} className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold">
                {creating ? "Creating..." : "Create Request"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {["draft", "approved", "received"].map(s => (
          <div key={s} className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-center">
            <div className="text-2xl font-black text-white">{orders.filter(r => r.status === s).length}</div>
            <div className="text-xs text-zinc-500 capitalize font-medium">{s}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {["all", "draft", "approved", "received"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`text-sm px-4 py-1.5 rounded-full border font-medium transition-colors capitalize ${statusFilter === s ? "bg-amber-500 border-amber-500 text-black" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50"}`}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="text-zinc-500 animate-pulse">Loading restock orders...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-12 text-center text-zinc-600">
          <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No restock orders {statusFilter !== "all" ? `with status "${statusFilter}"` : ""}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(order => (
            <div key={order.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex flex-col sm:flex-row justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-lg text-white">{order.ingredientName}</span>
                    {statusBadge(order.status)}
                    {order.status === "draft" && <span className="text-xs text-amber-400 flex items-center gap-1 animate-pulse"><Clock className="h-3 w-3" />Needs approval</span>}
                  </div>
                  <div className="text-zinc-400 text-sm">
                    Qty: <span className="font-bold text-white">{order.quantity} {order.ingredientUnit}</span>
                    {order.supplierName && <span className="ml-3">Supplier: <span className="font-bold text-white">{order.supplierName}</span>{order.supplierPhone && <span className="text-zinc-500"> · {order.supplierPhone}</span>}</span>}
                  </div>
                  {order.notes && <div className="text-xs text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-1.5 mt-2">{order.notes}</div>}
                  <div className="text-xs text-zinc-600 flex items-center gap-1"><Clock className="h-3 w-3" />Created {format(new Date(order.createdAt), "MMM d, HH:mm")}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {order.status === "draft" && (
                    <Button size="sm" className="bg-amber-500 hover:bg-amber-400 text-black font-bold" disabled={pending[order.id]} onClick={() => approve(order.id)}>
                      <CheckCircle2 className="h-4 w-4 mr-1" />{pending[order.id] ? "..." : "Approve"}
                    </Button>
                  )}
                  {order.status === "approved" && (
                    <Button size="sm" className="bg-green-500 hover:bg-green-400 text-black font-bold" disabled={pending[order.id]} onClick={() => receive(order.id)}>
                      <Truck className="h-4 w-4 mr-1" />{pending[order.id] ? "..." : "Mark Received"}
                    </Button>
                  )}
                  {order.status === "received" && (
                    <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="h-4 w-4" />Received {order.receivedAt ? format(new Date(order.receivedAt), "MMM d") : ""}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
