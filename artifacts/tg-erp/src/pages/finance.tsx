import { useState, useEffect, useCallback } from "react";
import {
  useGetFinanceSummary, useGetRevenueTrend, useListExpenses,
  useCreateExpense, useDeleteExpense, useListBranches,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { DollarSign, TrendingUp, TrendingDown, Receipt, Plus, Trash2, Globe, ChefHat, Bike, Settings2, Save } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { getApiBase } from "@/lib/api-base";

const BASE = getApiBase();
function getToken() { return localStorage.getItem("tg_erp_token"); }
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${getToken() ?? ""}`, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

interface AddisShipmentSummary { shipmentId: number; reference: string; sentDate: string; status: string; totalValueAed: number; totalPaidAed: number; outstandingAed: number }
interface StaffCommission { userId: number; name: string; role: string; type: string; orderCount: number; totalAed: number }
interface CommissionData {
  totalCommissions: number;
  totalChefCommissions: number;
  totalDeliveryCommissions: number;
  chefCommissionPerOrder: number;
  deliveryCommissionPerOrder: number;
  staffBreakdown: StaffCommission[];
}

const EXPENSE_CATEGORIES = ["Rent", "Utilities", "Supplies", "Payroll", "Marketing", "Maintenance", "Food", "Import Costs (Addis)", "Other"];
const EMPTY_FORM = { branchId: "", category: "Rent", amountAed: "", description: "" };

export default function Finance() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();

  const { data: summary } = useGetFinanceSummary({ branchId: user?.branchId ?? undefined });
  const { data: trend, isLoading: loadTrend } = useGetRevenueTrend({ branchId: user?.branchId ?? undefined, days: 7 });
  const { data: expenses, isLoading: loadExp } = useListExpenses({ branchId: user?.branchId ?? undefined });
  const { data: branches } = useListBranches();

  const [expenseDialog, setExpenseDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [addisShipments, setAddisShipments] = useState<AddisShipmentSummary[]>([]);
  const [addisTotalCost, setAddisTotalCost] = useState(0);
  const [commissions, setCommissions] = useState<CommissionData | null>(null);
  const [chefRate, setChefRate] = useState("");
  const [deliveryRate, setDeliveryRate] = useState("");
  const [savingRates, setSavingRates] = useState(false);
  const [showRateEdit, setShowRateEdit] = useState(false);

  useEffect(() => {
    apiFetch(`/api/addis/credit-summary${user?.branchId ? `?branchId=${user.branchId}` : ""}`)
      .then((data) => {
        const items: AddisShipmentSummary[] = data?.summary ?? [];
        setAddisShipments(items.filter((s) => s.status === "received" || s.totalValueAed > 0));
        setAddisTotalCost(items.reduce((s: number, r: AddisShipmentSummary) => s + r.totalValueAed, 0));
      })
      .catch(() => {});
  }, [user?.branchId]);

  const fetchCommissions = useCallback(() => {
    const qs = user?.branchId ? `?branchId=${user.branchId}` : "";
    apiFetch(`/api/finance/commissions${qs}`)
      .then((data: CommissionData) => {
        setCommissions(data);
        setChefRate(String(data.chefCommissionPerOrder));
        setDeliveryRate(String(data.deliveryCommissionPerOrder));
      })
      .catch(() => {});
  }, [user?.branchId]);

  useEffect(() => { fetchCommissions(); }, [fetchCommissions]);

  const saveRates = async () => {
    setSavingRates(true);
    try {
      await apiFetch("/api/finance/commission-rates", {
        method: "PATCH",
        body: JSON.stringify({
          chefCommissionPerOrder: parseFloat(chefRate) || 0,
          deliveryCommissionPerOrder: parseFloat(deliveryRate) || 0,
        }),
      });
      toast({ title: "Commission rates updated" });
      setShowRateEdit(false);
      fetchCommissions();
    } catch {
      toast({ title: "Error saving rates", variant: "destructive" });
    } finally {
      setSavingRates(false);
    }
  };

  const createExpense = useCreateExpense({ mutation: { onSuccess: () => { toast({ title: "Expense added" }); invalidate(); setExpenseDialog(false); setForm(EMPTY_FORM); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const deleteExpense = useDeleteExpense({ mutation: { onSuccess: () => { toast({ title: "Expense deleted" }); invalidate(); setDeleteId(null); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });

  const save = () => {
    createExpense.mutate({ data: { branchId: user?.branchId ?? Number(form.branchId), category: form.category, amountAed: Number(form.amountAed), description: form.description || "" } });
  };

  const netAfterCommissions = (summary?.netProfit ?? 0) - (commissions?.totalCommissions ?? 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Finance</h1>
          <p className="text-muted-foreground mt-1 text-sm">Revenue, expenses, commissions and profitability metrics.</p>
        </div>
      </div>

      {/* ── KPI CARDS ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              Total Revenue <TrendingUp className="h-4 w-4 text-green-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">{Number(summary?.totalRevenue ?? 0).toLocaleString()} AED</div>
            <p className="text-xs text-muted-foreground mt-1">{summary?.orderCount ?? 0} delivered orders</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              Total Expenses <TrendingDown className="h-4 w-4 text-red-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">{Number(summary?.totalExpenses ?? 0).toLocaleString()} AED</div>
            <p className="text-xs text-muted-foreground mt-1">Operational costs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              Staff Commissions <DollarSign className="h-4 w-4 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-500">{(commissions?.totalCommissions ?? 0).toLocaleString()} AED</div>
            <p className="text-xs text-muted-foreground mt-1">
              Chef: {commissions?.totalChefCommissions ?? 0} · Delivery: {commissions?.totalDeliveryCommissions ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-primary flex items-center justify-between">
              Net Profit <DollarSign className="h-4 w-4" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${netAfterCommissions >= 0 ? "text-primary" : "text-red-500"}`}>
              {netAfterCommissions.toLocaleString()} AED
            </div>
            <p className="text-xs text-primary/80 mt-1">After expenses &amp; commissions</p>
          </CardContent>
        </Card>
      </div>

      {/* ── REVENUE TREND ─────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle>7-Day Revenue Trend</CardTitle></CardHeader>
        <CardContent className="h-[250px] sm:h-[300px]">
          {loadTrend ? (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">Loading chart...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }} itemStyle={{ color: "hsl(var(--primary))" }} />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── STAFF COMMISSIONS ─────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row justify-between items-start gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-amber-500" />
              Staff Commissions
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-calculated per completed order. Chef earns on acceptance, delivery earns on completion.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowRateEdit(v => !v)} className="shrink-0">
            <Settings2 className="h-4 w-4 mr-1" />
            Rates
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Rate editor */}
          {showRateEdit && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-amber-400">Commission Rates per Order</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <ChefHat className="h-3.5 w-3.5" /> Chef commission (AED / order)
                  </Label>
                  <Input type="number" step="0.5" min="0" value={chefRate} onChange={e => setChefRate(e.target.value)} placeholder="5" className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Bike className="h-3.5 w-3.5" /> Delivery commission (AED / order)
                  </Label>
                  <Input type="number" step="0.5" min="0" value={deliveryRate} onChange={e => setDeliveryRate(e.target.value)} placeholder="10" className="h-9" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowRateEdit(false)}>Cancel</Button>
                <Button size="sm" onClick={saveRates} disabled={savingRates}>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {savingRates ? "Saving..." : "Save Rates"}
                </Button>
              </div>
            </div>
          )}

          {/* Current rates badges */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-full px-3 py-1.5 bg-amber-500/10 border border-amber-500/20 text-sm">
              <ChefHat className="h-4 w-4 text-amber-400" />
              <span className="text-muted-foreground">Chef rate:</span>
              <span className="font-bold text-amber-400">{commissions?.chefCommissionPerOrder ?? 5} AED / order</span>
            </div>
            <div className="flex items-center gap-2 rounded-full px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 text-sm">
              <Bike className="h-4 w-4 text-blue-400" />
              <span className="text-muted-foreground">Delivery rate:</span>
              <span className="font-bold text-blue-400">{commissions?.deliveryCommissionPerOrder ?? 10} AED / order</span>
            </div>
          </div>

          {/* Per-staff breakdown table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">Orders</TableHead>
                  <TableHead className="text-right">Total Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!commissions || commissions.staffBreakdown.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No commissions recorded yet. Commissions are added automatically when chefs accept orders and delivery staff complete deliveries.
                    </TableCell>
                  </TableRow>
                ) : commissions.staffBreakdown.map(s => (
                  <TableRow key={s.userId}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        s.type === "chef"
                          ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
                          : "text-blue-400 border-blue-500/30 bg-blue-500/10"
                      }>
                        {s.type === "chef" ? <ChefHat className="h-3 w-3 mr-1 inline" /> : <Bike className="h-3 w-3 mr-1 inline" />}
                        {s.type === "chef" ? "Chef" : "Delivery"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{s.orderCount}</TableCell>
                    <TableCell className="text-right font-bold text-amber-400">{s.totalAed.toLocaleString()} AED</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Total row */}
          {commissions && commissions.totalCommissions > 0 && (
            <div className="flex justify-between items-center pt-2 border-t border-border/50">
              <span className="text-sm text-muted-foreground">Total commissions paid</span>
              <span className="text-lg font-bold text-amber-400">{commissions.totalCommissions.toLocaleString()} AED</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── ADDIS IMPORT COSTS ─────────────────────────────────── */}
      {addisShipments.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row justify-between items-center">
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-orange-500" />
              Import Costs (Addis Ababa)
            </CardTitle>
            <Badge variant="outline" className="text-orange-400 border-orange-500/30 bg-orange-500/10">
              {addisTotalCost.toLocaleString()} AED total
            </Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shipment Ref</TableHead>
                  <TableHead>Sent Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total (AED)</TableHead>
                  <TableHead className="text-right">Paid (AED)</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {addisShipments.map((s) => (
                  <TableRow key={s.shipmentId}>
                    <TableCell className="font-mono font-bold">{s.reference}</TableCell>
                    <TableCell>{s.sentDate}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${s.status === "received" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {s.status.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-bold">{s.totalValueAed.toLocaleString()}</TableCell>
                    <TableCell className="text-right text-emerald-400">{s.totalPaidAed.toLocaleString()}</TableCell>
                    <TableCell className={`text-right font-bold ${s.outstandingAed > 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {s.outstandingAed > 0 ? s.outstandingAed.toFixed(0) : "Paid"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── EXPENSES ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> Expenses</CardTitle>
          <Button size="sm" onClick={() => { setForm({ ...EMPTY_FORM, branchId: String(user?.branchId ?? branches?.[0]?.id ?? "") }); setExpenseDialog(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Add Expense
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="hidden sm:table-cell">Description</TableHead>
                <TableHead className="hidden sm:table-cell">By</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadExp ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : expenses?.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No expenses logged yet</TableCell></TableRow>
              ) : expenses?.map(e => (
                <TableRow key={e.id}>
                  <TableCell>{format(new Date(e.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="capitalize">{e.category}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground">{e.description || "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{e.loggedByName || "System"}</TableCell>
                  <TableCell className="text-right font-bold text-red-500">{e.amountAed} AED</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" onClick={() => setDeleteId(e.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Expense Dialog */}
      <Dialog open={expenseDialog} onOpenChange={setExpenseDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!user?.branchId && (
              <div className="space-y-2">
                <Label>Branch</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.branchId} onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}>
                  <option value="">Select branch</option>
                  {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label>Category</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label>Amount (AED)</Label><Input type="number" step="0.01" value={form.amountAed} onChange={e => setForm(f => ({ ...f, amountAed: e.target.value }))} placeholder="1500" /></div>
            <div className="space-y-2"><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Monthly rent payment..." rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExpenseDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={createExpense.isPending || !form.amountAed || !form.category}>{createExpense.isPending ? "Adding..." : "Add Expense"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Expense?</AlertDialogTitle><AlertDialogDescription>This will remove the expense record permanently.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteExpense.mutate({ id: deleteId })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
