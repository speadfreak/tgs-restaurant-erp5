import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/use-socket";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Globe, Package, Plus, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle, Loader2, DollarSign, Truck, RefreshCw
} from "lucide-react";

interface Branch { id: number; name: string }
interface SupplierAddis { id: number; name: string; contactPhone: string | null; contactEmail: string | null; addressEthiopia: string | null; active: boolean }
interface ShipmentItem { itemName: string; quantity: string; unit: string; unitCostEtb: string; unitCostAed: string }
interface ImportShipment {
  id: number; reference: string; sentDate: string; status: string;
  totalValueEtb: string; totalValueAed: string;
  supplierId: number; supplierName?: string;
  notes: string | null; estimatedArrivalDate: string | null;
  paidAed?: number; outstandingAed?: number;
}
interface Payment { amountAed: string; paymentDate: string; paymentMethod: string; notes: string }

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

const STATUS_COLORS: Record<string, string> = {
  sent: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  in_transit: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  received: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  discrepancy_noted: "bg-red-500/20 text-red-400 border-red-500/30",
};

const EMPTY_ITEM: ShipmentItem = { itemName: "", quantity: "", unit: "kg", unitCostEtb: "", unitCostAed: "" };
const EMPTY_PAYMENT: Payment = { amountAed: "", paymentDate: new Date().toISOString().split("T")[0], paymentMethod: "bank_transfer", notes: "" };

export default function AddisPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const socket = useSocket({ branchId: user?.branchId ?? undefined });
  const [tab, setTab] = useState<"ledger" | "log" | "suppliers">("ledger");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierAddis[]>([]);
  const [shipments, setShipments] = useState<ImportShipment[]>([]);
  const [creditSummary, setCreditSummary] = useState<{ totalOutstanding: number; perSupplier: { supplierId: number; supplierName: string; outstanding: number }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<number>(0.02); // ~0.02 AED per ETB
  const [ledgerFilter, setLedgerFilter] = useState<string>("all");
  const [expandedShipment, setExpandedShipment] = useState<number | null>(null);
  const [shipmentItemsCache, setShipmentItemsCache] = useState<Record<number, { itemName: string; quantity: string; unit: string; unitCostEtb: string; unitCostAed: string; totalCostAed: string }[]>>({});

  // Log form
  const [logForm, setLogForm] = useState({ supplierId: "", reference: "", sentDate: new Date().toISOString().split("T")[0], estimatedArrivalDate: "", notes: "", logBranchId: "" });
  const [logItems, setLogItems] = useState<ShipmentItem[]>([{ ...EMPTY_ITEM }]);
  const [submittingLog, setSubmittingLog] = useState(false);

  // Payment form
  const [paymentForm, setPaymentForm] = useState<Payment>({ ...EMPTY_PAYMENT });
  const [payingShipmentId, setPayingShipmentId] = useState<number | null>(null);
  const [submittingPayment, setSubmittingPayment] = useState(false);

  // Supplier form
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: "", contactPhone: "", contactEmail: "", addressEthiopia: "", notes: "" });
  const [savingSupplier, setSavingSupplier] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sups, ships, brs] = await Promise.all([
        apiFetch("/api/addis/suppliers"),
        apiFetch(`/api/addis/shipments?branchId=${user?.branchId ?? ""}`),
        apiFetch("/api/branches").catch(() => []),
      ]);
      setSuppliers(Array.isArray(sups) ? sups : []);
      setShipments(Array.isArray(ships) ? ships : []);
      setBranches(Array.isArray(brs) ? brs : []);

      if (user?.branchId) {
        try {
          const credit = await apiFetch(`/api/addis/credit-summary?branchId=${user.branchId}`);
          // API returns { summary, totals: { totalOwed, totalPaid, totalOutstanding } }
          const totalOutstanding = credit?.totals?.totalOutstanding ?? credit?.totalOutstanding ?? 0;
          const perSupplier = (credit?.summary ?? []).map((s: { supplierId: number; reference: string; outstandingAed: number }) => ({
            supplierId: s.supplierId,
            supplierName: s.reference,
            outstanding: s.outstandingAed,
          }));
          setCreditSummary({ totalOutstanding, perSupplier });
        } catch { /* ignore */ }
        try {
          const rate = await apiFetch("/api/addis/exchange-rate");
          if (rate?.rate) setExchangeRate(Number(rate.rate));
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.branchId]);

  const fetchShipmentItems = useCallback(async (shipmentId: number) => {
    if (shipmentItemsCache[shipmentId]) return;
    try {
      const data = await apiFetch(`/api/addis/shipments/${shipmentId}`);
      setShipmentItemsCache(prev => ({ ...prev, [shipmentId]: data.items ?? [] }));
    } catch { /* ignore */ }
  }, [shipmentItemsCache]);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 30000); return () => clearInterval(iv); }, [fetchAll]);

  useEffect(() => {
    socket.on("addis:new_shipment", () => { fetchAll(); toast({ title: "New Addis shipment logged!" }); });
    return () => { socket.off("addis:new_shipment"); };
  }, [socket, fetchAll, toast]);

  const autoConvert = (etb: string) => {
    const n = parseFloat(etb);
    if (isNaN(n)) return "";
    return (n * exchangeRate).toFixed(2);
  };

  const updateItem = (i: number, field: keyof ShipmentItem, value: string) => {
    setLogItems(prev => prev.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: value };
      if (field === "unitCostEtb" && !updated.unitCostAed) {
        updated.unitCostAed = autoConvert(value);
      }
      return updated;
    }));
  };

  const addItem = () => setLogItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (i: number) => setLogItems(prev => prev.filter((_, idx) => idx !== i));

  const submitShipment = async () => {
    if (!user?.id) return; // auth guard — page should never reach here without a user
    const effectiveBranchId = user?.branchId ?? (logForm.logBranchId ? parseInt(logForm.logBranchId, 10) : null);
    if (!logForm.supplierId || !logForm.reference || !logForm.sentDate || logItems.some(i => !i.itemName) || !effectiveBranchId) return;
    setSubmittingLog(true);
    try {
      const totalEtb = logItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitCostEtb) || 0), 0);
      const totalAed = logItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitCostAed) || 0), 0);

      await apiFetch("/api/addis/shipments", "POST", {
        branchId: effectiveBranchId,
        supplierId: parseInt(logForm.supplierId, 10),
        reference: logForm.reference,
        sentDate: logForm.sentDate,
        estimatedArrivalDate: logForm.estimatedArrivalDate || null,
        notes: logForm.notes || null,
        totalValueEtb: totalEtb.toFixed(2),
        totalValueAed: totalAed.toFixed(2),
        exchangeRateUsed: exchangeRate.toFixed(4),
        loggedByUserId: user?.id,
        items: logItems.map(i => ({
          itemName: i.itemName,
          quantity: parseFloat(i.quantity) || 0,
          unit: i.unit,
          unitCostEtb: parseFloat(i.unitCostEtb) || 0,
          unitCostAed: parseFloat(i.unitCostAed) || 0,
          totalCostEtb: (parseFloat(i.quantity) || 0) * (parseFloat(i.unitCostEtb) || 0),
          totalCostAed: (parseFloat(i.quantity) || 0) * (parseFloat(i.unitCostAed) || 0),
        })),
      });
      toast({ title: "Shipment logged!", description: logForm.reference });
      setLogForm({ supplierId: "", reference: "", sentDate: new Date().toISOString().split("T")[0], estimatedArrivalDate: "", notes: "", logBranchId: "" });
      setLogItems([{ ...EMPTY_ITEM }]);
      fetchAll();
      setTab("ledger");
    } catch {
      toast({ title: "Error", description: "Could not submit shipment", variant: "destructive" });
    }
    setSubmittingLog(false);
  };

  const receiveShipment = async (id: number) => {
    try {
      await apiFetch(`/api/addis/shipments/${id}/receive`, "POST", { receivedByUserId: user?.id });
      toast({ title: "Shipment marked received" });
      fetchAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const submitPayment = async () => {
    if (!payingShipmentId || !paymentForm.amountAed) return;
    setSubmittingPayment(true);
    try {
      await apiFetch(`/api/addis/shipments/${payingShipmentId}/payments`, "POST", {
        ...paymentForm,
        recordedByUserId: user?.id,
      });
      toast({ title: "Payment recorded" });
      setPayingShipmentId(null);
      setPaymentForm({ ...EMPTY_PAYMENT });
      fetchAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
    setSubmittingPayment(false);
  };

  const saveSupplier = async () => {
    if (!supplierForm.name) return;
    setSavingSupplier(true);
    try {
      await apiFetch("/api/addis/suppliers", "POST", { ...supplierForm, createdByUserId: user?.id });
      toast({ title: "Supplier added" });
      setShowSupplierForm(false);
      setSupplierForm({ name: "", contactPhone: "", contactEmail: "", addressEthiopia: "", notes: "" });
      fetchAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
    setSavingSupplier(false);
  };

  const filtered = ledgerFilter === "all" ? shipments : shipments.filter(s => s.status === ledgerFilter);

  return (
    <div className="min-h-screen" style={{ background: "hsl(0 0% 4%)" }}>
      {/* ── HEADER ─────────────────── */}
      <div className="border-b relative" style={{ borderColor: "hsl(18 30% 10%)", background: "hsl(0 0% 2%)" }}>
        <div className="absolute top-0 left-0 right-0 h-[1px]"
          style={{ background: "linear-gradient(90deg, transparent, hsl(18 88% 48% / 0.6), transparent)" }} />
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: "hsl(18 40% 10%)", border: "1px solid hsl(18 88% 48% / 0.3)" }}>
                <Globe className="h-5 w-5 addis-accent" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="cinema-title text-2xl" style={{ background: "linear-gradient(135deg, hsl(18 88% 65%), hsl(18 88% 50%))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    Addis Ababa Supply Chain
                  </h1>
                  <span className="text-lg">🇪🇹</span>
                </div>
                <p className="cinema-subtitle">Ethiopia → Dubai Import Ledger</p>
              </div>
            </div>
            <button onClick={fetchAll} disabled={loading} className="p-2 rounded-lg border border-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Credit summary */}
          {creditSummary && creditSummary.totalOutstanding > 0 && (
            <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl border" style={{ background: "hsl(0 82% 8%)", borderColor: "hsl(0 82% 30%)" }}>
              <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <div>
                <span className="text-sm font-bold text-red-300">Outstanding Credit: </span>
                <span className="code-text text-red-400 font-black">AED {creditSummary.totalOutstanding.toLocaleString()}</span>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-0 mt-4 border-b -mb-[1px]" style={{ borderColor: "hsl(0 0% 10%)" }}>
            {(["ledger", "log", "suppliers"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${tab === t ? "text-orange-400" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
                style={{ borderBottomColor: tab === t ? "hsl(18 88% 48%)" : "transparent" }}>
                {t === "ledger" ? "Import Ledger" : t === "log" ? "Log Shipment" : "Suppliers"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {/* ── IMPORT LEDGER ──────────────────── */}
        {tab === "ledger" && (
          <div className="space-y-4">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {["all", "sent", "in_transit", "received", "discrepancy_noted"].map(f => (
                <button key={f} onClick={() => setLedgerFilter(f)}
                  className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${ledgerFilter === f ? "text-black border-orange-500" : "border-zinc-700 text-zinc-400 hover:border-orange-500/50"}`}
                  style={{ background: ledgerFilter === f ? "hsl(18 88% 48%)" : undefined }}>
                  {f === "all" ? "All" : f.replace(/_/g, " ")}
                </button>
              ))}
            </div>

            {filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed p-12 text-center" style={{ borderColor: "hsl(0 0% 14%)" }}>
                <Package className="h-10 w-10 mx-auto mb-3 text-zinc-700" />
                <p className="text-zinc-500">No shipments found</p>
                <button onClick={() => setTab("log")} className="mt-3 text-xs text-orange-400/70 hover:text-orange-400 border border-orange-500/20 px-3 py-1.5 rounded-lg transition-colors">
                  Log a shipment →
                </button>
              </div>
            )}

            {filtered.map(ship => {
              const outstanding = (Number(ship.totalValueAed) - (ship.paidAed ?? 0));
              const isPaid = outstanding <= 0;
              const isOverdue = !isPaid && ship.estimatedArrivalDate && new Date(ship.estimatedArrivalDate) < new Date() && ship.status !== "received";
              return (
                <div key={ship.id} className={`cinema-card rounded-xl overflow-hidden ${isOverdue ? "cinema-card-danger" : ""}`}>
                  <div className="p-4 flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="code-text text-zinc-100 font-bold">{ship.reference}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold capitalize ${STATUS_COLORS[ship.status] ?? "border-zinc-700 text-zinc-400"}`}>
                          {ship.status.replace(/_/g, " ")}
                        </span>
                        {isOverdue && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                            <AlertCircle className="h-3 w-3" />Overdue
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500">
                        Sent {ship.sentDate}
                        {ship.estimatedArrivalDate && ` · ETA ${ship.estimatedArrivalDate}`}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="code-text text-lg font-black text-orange-400">AED {Number(ship.totalValueAed).toLocaleString()}</div>
                      {!isPaid && (
                        <div className={`text-xs font-bold ${outstanding > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {outstanding > 0 ? `AED ${outstanding.toFixed(0)} owed` : "Paid ✓"}
                        </div>
                      )}
                      {isPaid && <div className="text-xs text-emerald-400 font-bold">Paid ✓</div>}
                    </div>
                  </div>

                  <div className="flex gap-2 px-4 pb-3">
                    {(ship.status === "sent" || ship.status === "in_transit") && (
                      <button onClick={() => receiveShipment(ship.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-950/30 transition-colors flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />Mark Received
                      </button>
                    )}
                    {!isPaid && (
                      <button onClick={() => { setPayingShipmentId(ship.id); setPaymentForm({ ...EMPTY_PAYMENT }); }}
                        className="text-xs px-3 py-1.5 rounded-lg border text-orange-400 hover:bg-orange-950/30 transition-colors flex items-center gap-1"
                        style={{ borderColor: "hsl(18 88% 48% / 0.3)" }}>
                        <DollarSign className="h-3 w-3" />Record Payment
                      </button>
                    )}
                    <button onClick={() => {
                      if (expandedShipment === ship.id) { setExpandedShipment(null); }
                      else { setExpandedShipment(ship.id); fetchShipmentItems(ship.id); }
                    }}
                      className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1">
                      {expandedShipment === ship.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}Items
                    </button>
                  </div>

                  {expandedShipment === ship.id && (
                    <div className="px-4 pb-4 pt-0">
                      <div className="rounded-xl border overflow-hidden text-xs" style={{ borderColor: "hsl(0 0% 12%)" }}>
                        <div className="grid grid-cols-5 gap-2 px-3 py-2 font-bold uppercase tracking-wider text-zinc-600" style={{ background: "hsl(0 0% 6%)" }}>
                          <span className="col-span-2">Item</span><span>Qty / Unit</span><span>ETB</span><span>AED Total</span>
                        </div>
                        {!shipmentItemsCache[ship.id] ? (
                          <div className="px-3 py-4 text-zinc-600 text-center">Loading items...</div>
                        ) : shipmentItemsCache[ship.id].length === 0 ? (
                          <div className="px-3 py-4 text-zinc-700 text-center">No items recorded</div>
                        ) : (
                          shipmentItemsCache[ship.id].map((item, idx) => (
                            <div key={idx} className="grid grid-cols-5 gap-2 px-3 py-2 border-t" style={{ borderColor: "hsl(0 0% 10%)" }}>
                              <span className="col-span-2 text-zinc-300 font-medium truncate">{item.itemName}</span>
                              <span className="text-zinc-400">{item.quantity} {item.unit}</span>
                              <span className="text-zinc-500">{Number(item.unitCostEtb).toLocaleString()}</span>
                              <span className="text-orange-400 font-bold">{Number(item.totalCostAed ?? item.unitCostAed).toFixed(0)}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── LOG SHIPMENT ───────────────────── */}
        {tab === "log" && (
          <div className="max-w-2xl space-y-5">
            <div className="cinema-card rounded-2xl p-5 space-y-4">
              <h3 className="cinema-title-sm text-orange-400 text-sm">New Shipment Details</h3>
              <div className="grid grid-cols-2 gap-4">
                {/* Branch selector — only shown when addis_staff has no fixed branch */}
                {!user?.branchId && (
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-zinc-400 text-xs uppercase tracking-wider">Destination Branch *</Label>
                    {branches.length === 0 ? (
                      <div className="flex items-center gap-2 text-xs text-amber-400 p-3 rounded-lg border border-amber-500/20 bg-amber-950/10">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        No branches loaded — refresh the page or contact admin.
                      </div>
                    ) : (
                      <select value={logForm.logBranchId} onChange={e => setLogForm(f => ({ ...f, logBranchId: e.target.value }))}
                        className="w-full h-10 px-3 rounded-lg border text-sm" style={{ background: "hsl(0 0% 7%)", borderColor: "hsl(0 0% 18%)", color: "hsl(42 25% 88%)" }}>
                        <option value="">Select destination branch...</option>
                        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-zinc-400 text-xs uppercase tracking-wider">Supplier *</Label>
                  <select value={logForm.supplierId} onChange={e => setLogForm(f => ({ ...f, supplierId: e.target.value }))}
                    className="w-full h-10 px-3 rounded-lg border text-sm" style={{ background: "hsl(0 0% 7%)", borderColor: "hsl(0 0% 18%)", color: "hsl(42 25% 88%)" }}>
                    <option value="">Select supplier...</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-400 text-xs uppercase tracking-wider">Reference *</Label>
                  <Input value={logForm.reference} onChange={e => setLogForm(f => ({ ...f, reference: e.target.value }))}
                    placeholder="June Batch 1" className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-400 text-xs uppercase tracking-wider">Sent Date *</Label>
                  <Input type="date" value={logForm.sentDate} onChange={e => setLogForm(f => ({ ...f, sentDate: e.target.value }))}
                    className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-400 text-xs uppercase tracking-wider">Est. Arrival</Label>
                  <Input type="date" value={logForm.estimatedArrivalDate} onChange={e => setLogForm(f => ({ ...f, estimatedArrivalDate: e.target.value }))}
                    className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-zinc-400 text-xs uppercase tracking-wider">Notes</Label>
                  <Input value={logForm.notes} onChange={e => setLogForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="Optional..." className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="cinema-card rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="cinema-title-sm text-orange-400 text-sm">Shipment Items *</h3>
                <div className="text-xs text-zinc-600">Exchange rate: 1 ETB = {exchangeRate} AED</div>
              </div>
              {logItems.map((item, i) => (
                <div key={i} className="grid grid-cols-5 gap-2 items-end">
                  <div className="col-span-2">
                    {i === 0 && <Label className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1 block">Item</Label>}
                    <Input value={item.itemName} onChange={e => updateItem(i, "itemName", e.target.value)}
                      placeholder="Berbere spice..." className="border-zinc-700/60 text-sm h-8" style={{ background: "hsl(0 0% 7%)" }} />
                  </div>
                  <div>
                    {i === 0 && <Label className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1 block">Qty</Label>}
                    <Input value={item.quantity} onChange={e => updateItem(i, "quantity", e.target.value)}
                      placeholder="0" className="border-zinc-700/60 text-sm h-8" style={{ background: "hsl(0 0% 7%)" }} />
                  </div>
                  <div>
                    {i === 0 && <Label className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1 block">Unit</Label>}
                    <Input value={item.unit} onChange={e => updateItem(i, "unit", e.target.value)}
                      placeholder="kg" className="border-zinc-700/60 text-sm h-8" style={{ background: "hsl(0 0% 7%)" }} />
                  </div>
                  <div className="flex gap-1">
                    <div className="flex-1">
                      {i === 0 && <Label className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1 block">ETB</Label>}
                      <Input value={item.unitCostEtb} onChange={e => updateItem(i, "unitCostEtb", e.target.value)}
                        placeholder="0" className="border-zinc-700/60 text-sm h-8" style={{ background: "hsl(0 0% 7%)" }} />
                    </div>
                    {i > 0 && (
                      <button onClick={() => removeItem(i)} className="h-8 px-2 text-red-600 hover:text-red-400 transition-colors text-xs flex-shrink-0">✕</button>
                    )}
                  </div>
                </div>
              ))}
              <button onClick={addItem} className="text-xs text-orange-400/70 hover:text-orange-400 flex items-center gap-1 transition-colors">
                <Plus className="h-3.5 w-3.5" />Add Item
              </button>
              <div className="border-t pt-3 text-right" style={{ borderColor: "hsl(0 0% 12%)" }}>
                <span className="text-zinc-500 text-sm">Total AED: </span>
                <span className="code-text text-orange-400 font-black text-lg ml-2">
                  {logItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitCostAed) || (parseFloat(i.unitCostEtb) || 0) * exchangeRate), 0).toFixed(2)}
                </span>
              </div>
            </div>

            <button
              onClick={submitShipment}
              disabled={submittingLog || !logForm.supplierId || !logForm.reference || logItems.some(i => !i.itemName) || (!user?.branchId && !logForm.logBranchId)}
              className="btn-cinema w-full h-12 flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: "hsl(18 88% 48%)", color: "white" }}
            >
              {submittingLog ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Truck className="h-4 w-4" />Submit Shipment</>}
            </button>
          </div>
        )}

        {/* ── SUPPLIERS ──────────────────────── */}
        {tab === "suppliers" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button onClick={() => setShowSupplierForm(!showSupplierForm)} className="btn-cinema text-xs flex items-center gap-1.5"
                style={{ background: "hsl(18 88% 48%)", color: "white" }}>
                <Plus className="h-3.5 w-3.5" />Add Supplier
              </button>
            </div>
            {showSupplierForm && (
              <div className="cinema-card rounded-2xl p-5 space-y-3">
                <h3 className="cinema-title-sm text-orange-400 text-sm">New Addis Supplier</h3>
                {[
                  { key: "name", label: "Name *", placeholder: "Supplier name..." },
                  { key: "contactPhone", label: "Phone", placeholder: "+251..." },
                  { key: "contactEmail", label: "Email", placeholder: "supplier@..." },
                  { key: "addressEthiopia", label: "Address", placeholder: "Addis Ababa..." },
                  { key: "notes", label: "Notes", placeholder: "..." },
                ].map(f => (
                  <div key={f.key} className="space-y-1.5">
                    <Label className="text-zinc-400 text-xs uppercase tracking-wider">{f.label}</Label>
                    <Input value={supplierForm[f.key as keyof typeof supplierForm]} onChange={e => setSupplierForm(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.placeholder} className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
                  </div>
                ))}
                <div className="flex gap-3">
                  <button onClick={() => setShowSupplierForm(false)} className="flex-1 h-9 text-sm border border-zinc-700 text-zinc-400 rounded-lg transition-colors">Cancel</button>
                  <button onClick={saveSupplier} disabled={savingSupplier || !supplierForm.name}
                    className="flex-1 h-9 text-sm font-bold text-white rounded-lg disabled:opacity-40"
                    style={{ background: "hsl(18 88% 48%)" }}>
                    {savingSupplier ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : "Save"}
                  </button>
                </div>
              </div>
            )}
            {suppliers.map(s => (
              <div key={s.id} className="cinema-card rounded-xl p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-zinc-100">{s.name}</div>
                  {s.contactPhone && <div className="text-xs text-zinc-500">{s.contactPhone}</div>}
                  {s.addressEthiopia && <div className="text-xs text-zinc-600">{s.addressEthiopia}</div>}
                </div>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${s.active ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-zinc-500/20 text-zinc-500 border-zinc-500/30"}`}>
                  {s.active ? "Active" : "Inactive"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payment modal */}
      {payingShipmentId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="cinema-card rounded-2xl p-6 w-full max-w-sm mx-4 space-y-4">
            <h3 className="cinema-title-sm text-orange-400 text-base">Record Payment</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Amount (AED) *</Label>
                <Input value={paymentForm.amountAed} onChange={e => setPaymentForm(f => ({ ...f, amountAed: e.target.value }))}
                  placeholder="0.00" type="number" className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Date</Label>
                <Input type="date" value={paymentForm.paymentDate} onChange={e => setPaymentForm(f => ({ ...f, paymentDate: e.target.value }))}
                  className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Method</Label>
                <select value={paymentForm.paymentMethod} onChange={e => setPaymentForm(f => ({ ...f, paymentMethod: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg border text-sm" style={{ background: "hsl(0 0% 7%)", borderColor: "hsl(0 0% 18%)", color: "hsl(42 25% 88%)" }}>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="western_union">Western Union</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Notes</Label>
                <Input value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional..." className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPayingShipmentId(null)} className="flex-1 h-9 text-sm border border-zinc-700 text-zinc-400 rounded-lg transition-colors">Cancel</button>
              <button onClick={submitPayment} disabled={submittingPayment || !paymentForm.amountAed}
                className="flex-1 h-9 text-sm font-bold text-black rounded-lg disabled:opacity-40"
                style={{ background: "hsl(38 88% 52%)" }}>
                {submittingPayment ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : "Record"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
