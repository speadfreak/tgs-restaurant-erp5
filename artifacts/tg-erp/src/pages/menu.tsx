import { useState } from "react";
import {
  useListMenuCategories, useListMenuItems,
  useCreateMenuCategory, useUpdateMenuCategory, useDeleteMenuCategory,
  useCreateMenuItem, useUpdateMenuItem, useDeleteMenuItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, FolderPlus } from "lucide-react";

type Category = { id: number; nameEn: string; nameAm: string; sortOrder: number };
type MenuItem = { id: number; categoryId: number; nameEn: string; nameAm: string; description?: string | null; priceAed: number; available: boolean };

const EMPTY_CAT = { nameEn: "", nameAm: "", sortOrder: "" };
const EMPTY_ITEM = { categoryId: "", nameEn: "", nameAm: "", description: "", priceAed: "", available: true };

export default function Menu() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();

  const { data: categories, isLoading: loadingCats } = useListMenuCategories({});
  const { data: items, isLoading: loadingItems } = useListMenuItems({});

  const [selectedCat, setSelectedCat] = useState<number | null>(null);
  const [catDialog, setCatDialog] = useState<{ open: boolean; editing: Category | null }>({ open: false, editing: null });
  const [catForm, setCatForm] = useState(EMPTY_CAT);
  const [itemDialog, setItemDialog] = useState<{ open: boolean; editing: MenuItem | null }>({ open: false, editing: null });
  const [itemForm, setItemForm] = useState<typeof EMPTY_ITEM>(EMPTY_ITEM);
  const [deleteDialog, setDeleteDialog] = useState<{ type: "cat" | "item"; id: number } | null>(null);

  const createCat = useCreateMenuCategory({ mutation: { onSuccess: () => { toast({ title: "Category created" }); invalidate(); setCatDialog({ open: false, editing: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const updateCat = useUpdateMenuCategory({ mutation: { onSuccess: () => { toast({ title: "Category updated" }); invalidate(); setCatDialog({ open: false, editing: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const deleteCat = useDeleteMenuCategory({ mutation: { onSuccess: () => { toast({ title: "Category deleted" }); invalidate(); setDeleteDialog(null); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const createItem = useCreateMenuItem({ mutation: { onSuccess: () => { toast({ title: "Item created" }); invalidate(); setItemDialog({ open: false, editing: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const updateItem = useUpdateMenuItem({ mutation: { onSuccess: () => { toast({ title: "Item updated" }); invalidate(); setItemDialog({ open: false, editing: null }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const deleteItem = useDeleteMenuItem({ mutation: { onSuccess: () => { toast({ title: "Item deleted" }); invalidate(); setDeleteDialog(null); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });

  const openAddCat = () => { setCatForm(EMPTY_CAT); setCatDialog({ open: true, editing: null }); };
  const openEditCat = (cat: Category) => { setCatForm({ nameEn: cat.nameEn, nameAm: cat.nameAm, sortOrder: String(cat.sortOrder ?? "") }); setCatDialog({ open: true, editing: cat }); };
  const openAddItem = () => { setItemForm({ ...EMPTY_ITEM, categoryId: selectedCat ? String(selectedCat) : "" }); setItemDialog({ open: true, editing: null }); };
  const openEditItem = (item: MenuItem) => { setItemForm({ categoryId: String(item.categoryId), nameEn: item.nameEn, nameAm: item.nameAm, description: item.description ?? "", priceAed: String(item.priceAed), available: item.available }); setItemDialog({ open: true, editing: item }); };

  const saveCat = () => {
    const body = { nameEn: catForm.nameEn, nameAm: catForm.nameAm, sortOrder: catForm.sortOrder ? Number(catForm.sortOrder) : undefined };
    if (catDialog.editing) updateCat.mutate({ id: catDialog.editing.id, data: body });
    else createCat.mutate({ data: body });
  };

  const saveItem = () => {
    const body = { categoryId: Number(itemForm.categoryId), nameEn: itemForm.nameEn, nameAm: itemForm.nameAm, description: itemForm.description || undefined, priceAed: Number(itemForm.priceAed), available: itemForm.available };
    if (itemDialog.editing) updateItem.mutate({ id: itemDialog.editing.id, data: body });
    else createItem.mutate({ data: body });
  };

  const toggleAvail = (item: MenuItem) => updateItem.mutate({ id: item.id, data: { available: !item.available } });

  const confirmDelete = () => {
    if (!deleteDialog) return;
    if (deleteDialog.type === "cat") deleteCat.mutate({ id: deleteDialog.id });
    else deleteItem.mutate({ id: deleteDialog.id });
  };

  const visibleItems = items?.filter(i => selectedCat ? i.categoryId === selectedCat : true);
  const catMutating = createCat.isPending || updateCat.isPending;
  const itemMutating = createItem.isPending || updateItem.isPending;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Menu Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage categories, items, and pricing.</p>
        </div>
        <Button onClick={openAddItem}><Plus className="mr-2 h-4 w-4" /> Add Item</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="md:col-span-1 h-fit">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-lg">Categories</CardTitle>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openAddCat}><FolderPlus className="h-4 w-4" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {loadingCats ? [1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />) : (
              <>
                <button onClick={() => setSelectedCat(null)} className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${selectedCat === null ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                  All Items ({items?.length ?? 0})
                </button>
                {categories?.map(cat => (
                  <div key={cat.id} className="flex items-center group">
                    <button onClick={() => setSelectedCat(cat.id)} className={`flex-1 text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${selectedCat === cat.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                      <div>{cat.nameEn}</div>
                      <div className="text-xs opacity-60">{cat.nameAm}</div>
                    </button>
                    <button onClick={() => openEditCat(cat)} className="p-1 opacity-40 hover:opacity-100 hover:text-primary transition-all" title="Edit category"><Edit className="h-3 w-3" /></button>
                    <button onClick={() => setDeleteDialog({ type: "cat", id: cat.id })} className="p-1 opacity-40 hover:opacity-100 hover:text-destructive transition-all" title="Delete category"><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-3">
          <CardHeader><CardTitle>Menu Items ({visibleItems?.length ?? 0})</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {loadingItems ? [1,2,3,4,5].map(i => <Skeleton key={i} className="h-36 w-full" />) : visibleItems?.map(item => (
                <div key={item.id} className="flex flex-col p-4 rounded-xl border bg-card gap-2">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <div className="font-bold leading-tight">{item.nameEn}</div>
                      <div className="text-xs text-muted-foreground">{item.nameAm}</div>
                    </div>
                    <Switch checked={item.available} onCheckedChange={() => toggleAvail(item)} />
                  </div>
                  {item.description && <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>}
                  <div className="mt-auto flex justify-between items-center pt-2 border-t border-border/50">
                    <span className="font-bold text-primary">{item.priceAed} AED</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditItem(item)}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => setDeleteDialog({ type: "item", id: item.id })}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  {!item.available && <Badge variant="secondary" className="text-xs self-start">Unavailable</Badge>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={catDialog.open} onOpenChange={open => setCatDialog(d => ({ ...d, open }))}>
        <DialogContent>
          <DialogHeader><DialogTitle>{catDialog.editing ? "Edit Category" : "Add Category"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Name (English)</Label><Input value={catForm.nameEn} onChange={e => setCatForm(f => ({ ...f, nameEn: e.target.value }))} placeholder="Main Dishes" /></div>
            <div className="space-y-2"><Label>Name (Amharic)</Label><Input value={catForm.nameAm} onChange={e => setCatForm(f => ({ ...f, nameAm: e.target.value }))} placeholder="ዋና ምግቦች" /></div>
            <div className="space-y-2"><Label>Sort Order</Label><Input type="number" value={catForm.sortOrder} onChange={e => setCatForm(f => ({ ...f, sortOrder: e.target.value }))} placeholder="1" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={saveCat} disabled={catMutating || !catForm.nameEn}>{catMutating ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={itemDialog.open} onOpenChange={open => setItemDialog(d => ({ ...d, open }))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{itemDialog.editing ? "Edit Menu Item" : "Add Menu Item"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={itemForm.categoryId} onChange={e => setItemForm(f => ({ ...f, categoryId: e.target.value }))}>
                <option value="">Select category</option>
                {categories?.map(c => <option key={c.id} value={c.id}>{c.nameEn}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Name (English)</Label><Input value={itemForm.nameEn} onChange={e => setItemForm(f => ({ ...f, nameEn: e.target.value }))} placeholder="Doro Wat" /></div>
              <div className="space-y-2"><Label>Name (Amharic)</Label><Input value={itemForm.nameAm} onChange={e => setItemForm(f => ({ ...f, nameAm: e.target.value }))} placeholder="ዶሮ ወጥ" /></div>
            </div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={itemForm.description} onChange={e => setItemForm(f => ({ ...f, description: e.target.value }))} placeholder="Ethiopian spiced chicken stew..." rows={2} /></div>
            <div className="space-y-2"><Label>Price (AED)</Label><Input type="number" step="0.5" value={itemForm.priceAed} onChange={e => setItemForm(f => ({ ...f, priceAed: e.target.value }))} placeholder="65" /></div>
            <div className="flex items-center gap-3"><Switch checked={itemForm.available} onCheckedChange={v => setItemForm(f => ({ ...f, available: v }))} /><Label>Available</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog({ open: false, editing: null })}>Cancel</Button>
            <Button onClick={saveItem} disabled={itemMutating || !itemForm.nameEn || !itemForm.priceAed || !itemForm.categoryId}>{itemMutating ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteDialog} onOpenChange={open => !open && setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirm Delete</AlertDialogTitle><AlertDialogDescription>This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
