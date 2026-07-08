import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import {
  DollarSign, TrendingUp, TrendingDown, Plus, Trash2, LogOut,
  ArrowUpCircle, ArrowDownCircle, RefreshCw, Receipt,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface FinanceEntry {
  id: number;
  branchId: number;
  branchName: string | null;
  loggedByUserId: number;
  loggedByName: string | null;
  entryType: "income" | "expense";
  category: string;
  amountAed: number;
  description: string;
  referenceNumber: string | null;
  notes: string | null;
  entryDate: string;
  isLocked: boolean;
  createdAt: string;
}

interface Summary {
  totalIncome: number;
  totalExpense: number;
  netBalance: number;
  entryCount: number;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function getToken() { return localStorage.getItem("tg_erp_token"); }
async function apiFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.status.toString());
    throw new Error(txt || String(res.status));
  }
  return res.json();
}

const INCOME_CATEGORIES = ["Sales", "Catering", "Event Revenue", "Tips", "Other Income"];
const EXPENSE_CATEGORIES = [
  "Rent", "Utilities", "Supplies", "Payroll", "Food & Beverage",
  "Marketing", "Maintenance", "Transport", "Miscellaneous",
];
const EMPTY_FORM = {
  entryType: "expense" as "income" | "expense",
  category: "Supplies",
  amountAed: "",
  description: "",
  referenceNumber: "",
  notes: "",
  entryDate: new Date().toISOString().split("T")[0],
};

export default function FinancePortal() {
  const { user, logout, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [entries, setEntries] = useState<FinanceEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && user && !["finance_staff", "super_admin", "branch_manager"].includes(user.role)) {
      setLocation("/dashboard");
    }
  }, [user, isLoading, setLocation]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date });
      const [entriesData, summaryData] = await Promise.all([
        apiFetch(`/api/finance/entries?${params}`),
        apiFetch(`/api/finance/entries/summary?${params}`),
      ]);
      setEntries(entriesData);
      setSummary(summaryData);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      toast({ title: "Load failed", description: msg, variant: "destructive" });
    }
    setLoading(false);
  }, [date, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, entryDate: date });
    setDialog(true);
  };

  const save = async () => {
    if (!form.category || !form.amountAed || !form.description || !form.entryDate) {
      toast({ title: "Fill all required fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/finance/entries", "POST", {
        entryType: form.entryType,
        category: form.category,
        amountAed: parseFloat(form.amountAed),
        description: form.description,
        referenceNumber: form.referenceNumber || null,
        notes: form.notes || null,
        entryDate: form.entryDate,
      });
      toast({ title: "Entry saved" });
      setDialog(false);
      await fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Save failed";
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    }
    setSaving(false);
  };

  const deleteEntry = async () => {
    if (!deleteId) return;
    try {
      await apiFetch(`/api/finance/entries/${deleteId}`, "DELETE");
      toast({ title: "Entry deleted" });
      setDeleteId(null);
      await fetchData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      toast({ title: "Delete failed", description: msg, variant: "destructive" });
    }
  };

  const categories = form.entryType === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-amber-400 animate-pulse font-bold text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-zinc-900 border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Receipt className="h-4.5 w-4.5 text-amber-400" />
          </div>
          <div>
            <div className="text-amber-400 font-bold text-xs tracking-widest uppercase">Finance Portal</div>
            <div className="text-zinc-400 text-xs">{user?.name} · {user?.role?.replace(/_/g, " ")}</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="text-zinc-600 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-950/20 transition-colors"
          title="Log out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-5">
        {/* Date filter + Add button */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-zinc-900 border-zinc-700 text-zinc-100 w-44"
            />
          </div>
          <Button
            onClick={openAdd}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold"
          >
            <Plus className="h-4 w-4 mr-2" />Log Entry
          </Button>
          <Button variant="outline" size="icon" onClick={fetchData} disabled={loading} className="border-zinc-700">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* Summary cards */}
        {summary && (
          <div className="grid grid-cols-3 gap-3">
            <Card className="bg-emerald-950/40 border-emerald-500/20">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpCircle className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-zinc-400">Income</span>
                </div>
                <div className="text-xl font-black text-emerald-400">
                  {summary.totalIncome.toFixed(2)} <span className="text-xs font-normal">AED</span>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-red-950/40 border-red-500/20">
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowDownCircle className="h-4 w-4 text-red-400" />
                  <span className="text-xs text-zinc-400">Expenses</span>
                </div>
                <div className="text-xl font-black text-red-400">
                  {summary.totalExpense.toFixed(2)} <span className="text-xs font-normal">AED</span>
                </div>
              </CardContent>
            </Card>
            <Card className={`border-${summary.netBalance >= 0 ? "amber" : "red"}-500/20 bg-${summary.netBalance >= 0 ? "amber" : "red"}-950/20`}>
              <CardContent className="pt-4 pb-3">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className={`h-4 w-4 ${summary.netBalance >= 0 ? "text-amber-400" : "text-red-400"}`} />
                  <span className="text-xs text-zinc-400">Net Balance</span>
                </div>
                <div className={`text-xl font-black ${summary.netBalance >= 0 ? "text-amber-400" : "text-red-400"}`}>
                  {summary.netBalance >= 0 ? "+" : ""}{summary.netBalance.toFixed(2)} <span className="text-xs font-normal">AED</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Entry list */}
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-zinc-300 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-400" />
              Entries for {date}
              {loading && <span className="text-xs text-zinc-600 ml-2 animate-pulse">Loading...</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {entries.length === 0 && !loading && (
              <div className="flex flex-col items-center py-10 gap-2">
                <Receipt className="h-8 w-8 text-zinc-700" />
                <p className="text-zinc-500 text-sm">No entries for this date</p>
                <Button variant="outline" size="sm" onClick={openAdd} className="border-zinc-700 text-xs mt-1">
                  <Plus className="h-3 w-3 mr-1" />Add First Entry
                </Button>
              </div>
            )}
            {entries.map(entry => {
              const isIncome = entry.entryType === "income";
              const ageMs = Date.now() - new Date(entry.createdAt).getTime();
              const canDelete = !entry.isLocked && ageMs < 60 * 60 * 1000;
              return (
                <div
                  key={entry.id}
                  className="flex items-start justify-between gap-3 p-3 rounded-lg border"
                  style={{ background: isIncome ? "hsl(142 30% 5%)" : "hsl(0 30% 5%)", borderColor: isIncome ? "hsl(142 50% 15%)" : "hsl(0 50% 15%)" }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0 ${isIncome ? "bg-emerald-500/20" : "bg-red-500/20"}`}>
                      {isIncome
                        ? <TrendingUp className="h-3 w-3 text-emerald-400" />
                        : <TrendingDown className="h-3 w-3 text-red-400" />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-zinc-100">{entry.description}</span>
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${isIncome ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>
                          {entry.category}
                        </Badge>
                        {entry.isLocked && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-zinc-600 text-zinc-500">Locked</Badge>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        By {entry.loggedByName} · {entry.branchName}
                        {entry.referenceNumber && <> · Ref: {entry.referenceNumber}</>}
                      </div>
                      {entry.notes && <div className="text-xs text-zinc-600 mt-0.5 italic">{entry.notes}</div>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    <span className={`text-base font-black ${isIncome ? "text-emerald-400" : "text-red-400"}`}>
                      {isIncome ? "+" : "-"}{entry.amountAed.toFixed(2)}
                      <span className="text-xs font-normal ml-0.5">AED</span>
                    </span>
                    {canDelete && (
                      <button
                        onClick={() => setDeleteId(entry.id)}
                        className="text-zinc-700 hover:text-red-400 p-1 rounded hover:bg-red-950/20 transition-colors"
                        title="Delete entry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Add Entry Dialog */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="bg-zinc-900 border-zinc-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-zinc-100">Log Finance Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {/* Entry type toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setForm(f => ({ ...f, entryType: "income", category: INCOME_CATEGORIES[0] }))}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors border ${form.entryType === "income"
                  ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                  : "border-zinc-700 text-zinc-500 hover:border-zinc-600"}`}
              >
                <ArrowUpCircle className="h-4 w-4 inline mr-1.5" />Income
              </button>
              <button
                onClick={() => setForm(f => ({ ...f, entryType: "expense", category: EXPENSE_CATEGORIES[0] }))}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors border ${form.entryType === "expense"
                  ? "bg-red-500/20 border-red-500/50 text-red-400"
                  : "border-zinc-700 text-zinc-500 hover:border-zinc-600"}`}
              >
                <ArrowDownCircle className="h-4 w-4 inline mr-1.5" />Expense
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Category *</Label>
                <select
                  className="w-full h-9 rounded-md border bg-zinc-950 border-zinc-700 text-zinc-100 px-3 text-sm"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Amount (AED) *</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amountAed}
                  onChange={e => setForm(f => ({ ...f, amountAed: e.target.value }))}
                  placeholder="0.00"
                  className="bg-zinc-950 border-zinc-700 text-zinc-100"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Description *</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brief description..."
                className="bg-zinc-950 border-zinc-700 text-zinc-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Entry Date *</Label>
                <Input
                  type="date"
                  value={form.entryDate}
                  onChange={e => setForm(f => ({ ...f, entryDate: e.target.value }))}
                  className="bg-zinc-950 border-zinc-700 text-zinc-100"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs">Reference # (optional)</Label>
                <Input
                  value={form.referenceNumber}
                  onChange={e => setForm(f => ({ ...f, referenceNumber: e.target.value }))}
                  placeholder="INV-001"
                  className="bg-zinc-950 border-zinc-700 text-zinc-100"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-zinc-400 text-xs">Notes (optional)</Label>
              <Textarea
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Additional notes..."
                rows={2}
                className="bg-zinc-950 border-zinc-700 text-zinc-100 resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)} className="border-zinc-700 text-zinc-300">Cancel</Button>
            <Button
              onClick={save}
              disabled={saving}
              className={form.entryType === "income" ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-amber-500 hover:bg-amber-400 text-black"}
            >
              {saving ? "Saving..." : "Save Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent className="bg-zinc-900 border-zinc-700">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Delete entry?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              This action cannot be undone. Entries can only be deleted within 1 hour of creation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 text-zinc-300">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteEntry} className="bg-red-600 hover:bg-red-500 text-white">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
