import { useState } from "react";
import { useListInventoryItems, useListWasteLogs, useListBranches, useCreateInventoryItem, useUpdateInventoryItem, useDeleteInventoryItem, useCreateWasteLog } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Plus, Edit, Trash2 } from "lucide-react";
import { format } from "date-fns";

const EMPTY_ITEM = { branchId: "", name: "", unit: "kg", quantityOnHand: "", reorderThreshold: "", supplier: "" };
const EMPTY_WASTE = { ingredientId: "", ingredientName: "", quantity: "", reason: "" };

export default function Inventory() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();

  const { data: items, isLoading: loadingItems } = useListInventoryItems({ branchId: user?.branchId ?? undefined });
  const { data: wasteLogs, isLoading: loadingWaste } = useListWasteLogs({ branchId: user?.branchId ?? undefined });
  const { data: branches } = useListBranches();

  const [itemDialog, setItemDialog] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [wasteDialog, setWasteDialog] = useState(false);
  const [wasteForm, setWasteForm] = useState(EMPTY_WASTE);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const createItem = useCreateInventoryItem({ mutation: { onSuccess: () => { toast({ title: "Item added" }); invalidate(); setItemDialog({ open: false, editId: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const updateItem = useUpdateInventoryItem({ mutation: { onSuccess: () => { toast({ title: "Item updated" }); invalidate(); setItemDialog({ open: false, editId: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const deleteItem = useDeleteInventoryItem({ mutation: { onSuccess: () => { toast({ title: "Item deleted" }); invalidate(); setDeleteId(null); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const createWaste = useCreateWasteLog({ mutation: { onSuccess: () => { toast({ title: "Waste logged" }); invalidate(); setWasteDialog(false); setWasteForm(EMPTY_WASTE); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });

  const openAdd = () => { setItemForm({ ...EMPTY_ITEM, branchId: String(user?.branchId ?? branches?.[0]?.id ?? "") }); setItemDialog({ open: true, editId: null }); };
  const openEdit = (i: { id: number; branchId: number; name: string; unit: string; quantityOnHand: number; reorderThreshold: number; supplier?: string | null }) => {
    setItemForm({ branchId: String(i.branchId), name: i.name, unit: i.unit, quantityOnHand: String(i.quantityOnHand), reorderThreshold: String(i.reorderThreshold), supplier: i.supplier ?? "" });
    setItemDialog({ open: true, editId: i.id });
  };

  const saveItem = () => {
    const body = { branchId: Number(itemForm.branchId), name: itemForm.name, unit: itemForm.unit, quantityOnHand: Number(itemForm.quantityOnHand), reorderThreshold: Number(itemForm.reorderThreshold), supplier: itemForm.supplier || undefined };
    if (itemDialog.editId) updateItem.mutate({ id: itemDialog.editId, data: { name: body.name, unit: body.unit, quantityOnHand: body.quantityOnHand, reorderThreshold: body.reorderThreshold, supplier: body.supplier } });
    else createItem.mutate({ data: body });
  };

  const saveWaste = () => {
    createWaste.mutate({ data: { branchId: user?.branchId ?? Number(items?.find(i => String(i.id) === wasteForm.ingredientId)?.branchId), ingredientId: Number(wasteForm.ingredientId), quantity: Number(wasteForm.quantity), reason: wasteForm.reason || "Not specified" } });
  };

  const lowStockCount = items?.filter(i => i.isLowStock).length ?? 0;
  const mutating = createItem.isPending || updateItem.isPending;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Inventory & Waste</h1>
          <p className="text-muted-foreground mt-1 text-sm">Track stock levels and log waste.</p>
        </div>
        {lowStockCount > 0 && <Badge variant="destructive" className="flex items-center gap-1 self-start"><AlertTriangle className="h-3 w-3" /> {lowStockCount} Low Stock</Badge>}
      </div>

      <Tabs defaultValue="stock" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="stock">Stock Levels</TabsTrigger>
          <TabsTrigger value="waste">Waste Log</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle>Current Stock</CardTitle>
              <Button size="sm" onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="hidden sm:table-cell">Supplier</TableHead>
                    <TableHead>In Stock</TableHead>
                    <TableHead className="hidden sm:table-cell">Threshold</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingItems ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : items?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No stock items yet</TableCell></TableRow>
                  ) : items?.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="hidden sm:table-cell">{i.supplier || "—"}</TableCell>
                      <TableCell className="font-mono">{i.quantityOnHand} {i.unit}</TableCell>
                      <TableCell className="hidden sm:table-cell font-mono text-muted-foreground">{i.reorderThreshold} {i.unit}</TableCell>
                      <TableCell>
                        {i.isLowStock ? (
                          <Badge variant="destructive" className="flex w-fit items-center gap-1"><AlertTriangle className="h-3 w-3" /> Low</Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-500 border-green-500/50 bg-green-500/10">Good</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(i)}><Edit className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" onClick={() => setDeleteId(i.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="waste">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle>Waste Log</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setWasteDialog(true)}><Plus className="mr-2 h-4 w-4" /> Log Waste</Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingWaste ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : wasteLogs?.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No waste logs yet</TableCell></TableRow>
                  ) : wasteLogs?.map(w => (
                    <TableRow key={w.id}>
                      <TableCell>{format(new Date(w.createdAt), "MMM d, HH:mm")}</TableCell>
                      <TableCell className="font-medium">{w.ingredientName || `Item #${w.ingredientId}`}</TableCell>
                      <TableCell className="text-red-500 font-bold">{w.quantity}</TableCell>
                      <TableCell>{w.reason || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={itemDialog.open} onOpenChange={open => setItemDialog(d => ({ ...d, open }))}>
        <DialogContent>
          <DialogHeader><DialogTitle>{itemDialog.editId ? "Edit Stock Item" : "Add Stock Item"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!user?.branchId && !itemDialog.editId && (
              <div className="space-y-2">
                <Label>Branch</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={itemForm.branchId} onChange={e => setItemForm(f => ({ ...f, branchId: e.target.value }))}>
                  <option value="">Select branch</option>
                  {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-2"><Label>Item Name</Label><Input value={itemForm.name} onChange={e => setItemForm(f => ({ ...f, name: e.target.value }))} placeholder="Berbere Spice" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Unit</Label><Input value={itemForm.unit} onChange={e => setItemForm(f => ({ ...f, unit: e.target.value }))} placeholder="kg, liters, pieces" /></div>
              <div className="space-y-2"><Label>Quantity</Label><Input type="number" step="0.1" value={itemForm.quantityOnHand} onChange={e => setItemForm(f => ({ ...f, quantityOnHand: e.target.value }))} placeholder="5" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Reorder Threshold</Label><Input type="number" step="0.1" value={itemForm.reorderThreshold} onChange={e => setItemForm(f => ({ ...f, reorderThreshold: e.target.value }))} placeholder="2" /></div>
              <div className="space-y-2"><Label>Supplier</Label><Input value={itemForm.supplier} onChange={e => setItemForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Supplier name" /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog({ open: false, editId: null })}>Cancel</Button>
            <Button onClick={saveItem} disabled={mutating || !itemForm.name || !itemForm.quantityOnHand}>{mutating ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={wasteDialog} onOpenChange={setWasteDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Waste</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Stock Item</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={wasteForm.ingredientId} onChange={e => { const item = items?.find(i => String(i.id) === e.target.value); setWasteForm(f => ({ ...f, ingredientId: e.target.value, ingredientName: item?.name ?? "" })); }}>
                <option value="">Select item</option>
                {items?.map(i => <option key={i.id} value={i.id}>{i.name} ({i.quantityOnHand} {i.unit})</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label>Quantity Lost</Label><Input type="number" step="0.1" value={wasteForm.quantity} onChange={e => setWasteForm(f => ({ ...f, quantity: e.target.value }))} placeholder="0.5" /></div>
            <div className="space-y-2"><Label>Reason</Label><Input value={wasteForm.reason} onChange={e => setWasteForm(f => ({ ...f, reason: e.target.value }))} placeholder="Spoilage, dropped, expired..." /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWasteDialog(false)}>Cancel</Button>
            <Button onClick={saveWaste} disabled={createWaste.isPending || !wasteForm.ingredientId || !wasteForm.quantity}>{createWaste.isPending ? "Logging..." : "Log Waste"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Stock Item?</AlertDialogTitle><AlertDialogDescription>This will permanently remove the item.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteItem.mutate({ id: deleteId })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
