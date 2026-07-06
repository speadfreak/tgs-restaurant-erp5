import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/hooks/use-socket";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MessageSquare, Mic, Clock, ChevronDown, ChevronUp,
  CheckCircle, XCircle, Loader2, Phone, User, Bell, Wifi, WifiOff
} from "lucide-react";

interface QueueOrder {
  id: number;
  orderCode: string;
  queueNumber: number | null;
  status: string;
  customerPhoneDirect: string | null;
  customerNameDirect: string | null;
  whatsappMessageType: string | null;
  whatsappMediaUrl: string | null;
  autoReplySent: boolean | null;
  intakeClaimedByUserId: number | null;
  createdAt: string;
}
interface MenuItem { id: number; nameEn: string; nameAm: string; priceAed: number; categoryId: number }
interface Category { id: number; nameEn: string }
interface CartItem { menuItemId: number; name: string; quantity: number; unitPrice: number }

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

function elapsedMins(createdAt: string) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
}
function urgency(mins: number): { color: string; label: string; borderColor: string } {
  if (mins >= 10) return { color: "text-red-400", label: "URGENT", borderColor: "hsl(0 82% 52%)" };
  if (mins >= 5)  return { color: "text-amber-400", label: "WAITING", borderColor: "hsl(38 88% 52%)" };
  return { color: "text-emerald-400", label: "RECENT", borderColor: "hsl(142 70% 45%)" };
}

export default function OrderQueue() {
  const { user } = useAuth();
  const { toast } = useToast();
  const socket = useSocket({ branchId: user?.branchId ?? undefined, userId: user?.id });
  const [socketConnected, setSocketConnected] = useState(false);
  const [queue, setQueue] = useState<QueueOrder[]>([]);
  const [dismissed, setDismissed] = useState<QueueOrder[]>([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [claimPending, setClaimPending] = useState<Record<number, boolean>>({});
  const [tick, setTick] = useState(0);

  // Confirm panel state
  const [confirmingOrder, setConfirmingOrder] = useState<QueueOrder | null>(null);
  const [confirmForm, setConfirmForm] = useState({ customerName: "", deliveryAddress: "", note: "" });
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<number | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  // Dismiss dialog
  const [dismissingId, setDismissingId] = useState<number | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (user?.branchId) params.set("branchId", String(user.branchId));
      const data: QueueOrder[] = await apiFetch(`/api/whatsapp/queue?${params}`);
      setQueue(data.filter(o => o.status === "queue"));
      setDismissed(data.filter(o => o.status === "dismissed"));
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.branchId]);

  const fetchMenu = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([
        apiFetch("/api/menu/categories"),
        apiFetch("/api/menu/items?available=true"),
      ]);
      setCategories(cats);
      setMenuItems(items);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchQueue(); fetchMenu(); const iv = setInterval(fetchQueue, 10000); return () => clearInterval(iv); }, [fetchQueue, fetchMenu]);
  useEffect(() => { const iv = setInterval(() => setTick(t => t + 1), 15000); return () => clearInterval(iv); }, []);

  useEffect(() => {
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("order:queue_new", () => {
      fetchQueue();
      toast({ title: "New WhatsApp order received!", description: "A new queue entry just came in." });
    });
    return () => { socket.off("order:queue_new"); };
  }, [socket, fetchQueue, toast]);

  const claim = async (order: QueueOrder) => {
    setClaimPending(p => ({ ...p, [order.id]: true }));
    try {
      await apiFetch(`/api/whatsapp/queue/${order.id}/claim`, "POST", { userId: user?.id });
      setConfirmingOrder(order);
      setConfirmForm({ customerName: order.customerNameDirect ?? "", deliveryAddress: "", note: "" });
      setCart([]);
      fetchQueue();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      toast({ title: "Could not claim", description: msg.includes("409") ? "Already claimed by another staff" : "Try again", variant: "destructive" });
    }
    setClaimPending(p => ({ ...p, [order.id]: false }));
  };

  const confirmOrder = async () => {
    if (!confirmingOrder || cart.length === 0) return;
    setConfirmPending(true);
    try {
      await apiFetch(`/api/whatsapp/queue/${confirmingOrder.id}/confirm`, "POST", {
        userId: user?.id,
        customerName: confirmForm.customerName,
        deliveryAddress: confirmForm.deliveryAddress,
        items: cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity, unitPrice: c.unitPrice })),
      });
      toast({ title: "Order confirmed!", description: `Queue #${confirmingOrder.queueNumber} sent to kitchen` });
      setConfirmingOrder(null);
      setCart([]);
      fetchQueue();
    } catch {
      toast({ title: "Error", description: "Could not confirm order", variant: "destructive" });
    }
    setConfirmPending(false);
  };

  const dismissOrder = async () => {
    if (!dismissingId || !dismissReason.trim()) return;
    try {
      await apiFetch(`/api/whatsapp/queue/${dismissingId}/dismiss`, "POST", { userId: user?.id, reason: dismissReason });
      toast({ title: "Entry dismissed" });
      setDismissingId(null);
      setDismissReason("");
      fetchQueue();
    } catch {
      toast({ title: "Error", description: "Could not dismiss", variant: "destructive" });
    }
  };

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const ex = prev.find(c => c.menuItemId === item.id);
      if (ex) return prev.map(c => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, name: item.nameEn, quantity: 1, unitPrice: item.priceAed }];
    });
  };

  const filteredItems = menuItems.filter(i => !selectedCat || i.categoryId === selectedCat);
  const cartTotal = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  // ── CONFIRM PANEL ─────────────────────────────────────────────────────
  if (confirmingOrder) {
    return (
      <div className="min-h-screen p-6" style={{ background: "hsl(0 0% 4%)" }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setConfirmingOrder(null)} className="text-zinc-500 hover:text-zinc-200 text-sm border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors">← Back</button>
            <div>
              <h2 className="cinema-title text-xl">Confirm Order</h2>
              <p className="cinema-subtitle">Queue #{confirmingOrder.queueNumber} · {confirmingOrder.customerPhoneDirect}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="cinema-card rounded-xl p-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Customer Name</Label>
                <Input value={confirmForm.customerName} onChange={e => setConfirmForm(f => ({ ...f, customerName: e.target.value }))}
                  placeholder="Full name" className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Delivery Address</Label>
                <Input value={confirmForm.deliveryAddress} onChange={e => setConfirmForm(f => ({ ...f, deliveryAddress: e.target.value }))}
                  placeholder="Street, building, flat..." className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Internal Note (Optional)</Label>
                <Input value={confirmForm.note} onChange={e => setConfirmForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="What you heard on the voice note..." className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
            </div>

            {/* Category pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              <button onClick={() => setSelectedCat(null)} className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${selectedCat === null ? "bg-amber-500 text-black border-amber-500" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50"}`}>All</button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setSelectedCat(c.id)} className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${selectedCat === c.id ? "bg-amber-500 text-black border-amber-500" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50"}`}>{c.nameEn}</button>
              ))}
            </div>

            {/* Menu grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
              {filteredItems.map(item => {
                const inCart = cart.find(c => c.menuItemId === item.id);
                return (
                  <button key={item.id} onClick={() => addToCart(item)}
                    className={`text-left p-3 rounded-xl border transition-all ${inCart ? "border-amber-500/60 bg-amber-950/20" : "border-zinc-800 hover:border-amber-500/30"}`}
                    style={{ background: inCart ? undefined : "hsl(0 0% 6%)" }}>
                    <div className="font-semibold text-sm text-zinc-100 leading-tight">{item.nameEn}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-amber-400 font-bold text-sm">{item.priceAed} AED</span>
                      {inCart && <span className="text-amber-400 font-black text-sm">×{inCart.quantity}</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Cart */}
            {cart.length > 0 && (
              <div className="cinema-card rounded-xl p-4 space-y-2">
                <h4 className="font-bold text-zinc-200 text-sm">Cart</h4>
                {cart.map(i => (
                  <div key={i.menuItemId} className="flex justify-between items-center text-sm">
                    <span className="text-zinc-300">{i.name} ×{i.quantity}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-bold">{(i.quantity * i.unitPrice).toFixed(0)} AED</span>
                      <button onClick={() => setCart(prev => prev.filter(c => c.menuItemId !== i.menuItemId))} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                    </div>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between font-black" style={{ borderColor: "hsl(0 0% 12%)" }}>
                  <span className="text-zinc-300">Total</span>
                  <span className="text-amber-400">{cartTotal.toFixed(2)} AED</span>
                </div>
              </div>
            )}

            <Button
              className="w-full h-12 font-black text-sm rounded-xl text-black"
              style={{ background: "hsl(38 88% 52%)" }}
              disabled={confirmPending || cart.length === 0 || !confirmForm.customerName}
              onClick={confirmOrder}
            >
              {confirmPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "✓ Confirm Order — Send to Kitchen"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── MAIN QUEUE VIEW ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: "hsl(0 0% 4%)" }}>
      {/* Header */}
      <div className="border-b relative" style={{ borderColor: "hsl(38 30% 10%)", background: "hsl(0 0% 2%)" }}>
        <div className="absolute top-0 left-0 right-0 h-[1px]" style={{ background: "linear-gradient(90deg, transparent, hsl(38 88% 52% / 0.6), transparent)" }} />
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: "hsl(38 50% 10%)", border: "1px solid hsl(38 88% 52% / 0.3)" }}>
                <MessageSquare className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h1 className="cinema-title text-2xl">Order Queue</h1>
                <p className="cinema-subtitle">WhatsApp Voice Intake — Today</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {queue.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400">
                  <Bell className="h-3.5 w-3.5 animate-pulse" />{queue.length} pending
                </div>
              )}
              <div className={`live-badge ${socketConnected ? "" : "opacity-50"}`}>
                {socketConnected ? <><span className="status-dot status-dot-live" />Live</> : <WifiOff className="h-3 w-3" />}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4" key={tick}>
        {queue.length === 0 && !loading && (
          <div className="rounded-2xl border border-dashed p-16 text-center" style={{ borderColor: "hsl(0 0% 14%)" }}>
            <MessageSquare className="h-12 w-12 mx-auto mb-3 text-zinc-700" />
            <p className="text-zinc-500 font-medium">Queue is clear</p>
            <p className="text-zinc-700 text-sm mt-1">New WhatsApp messages will appear here instantly</p>
          </div>
        )}

        {queue.map(order => {
          const mins = elapsedMins(order.createdAt);
          const u = urgency(mins);
          const isMine = order.intakeClaimedByUserId === user?.id;
          const isClaimed = !!order.intakeClaimedByUserId && !isMine;

          return (
            <div
              key={order.id}
              className="queue-card"
              style={{ borderLeftColor: u.borderColor }}
            >
              <div className="flex items-start justify-between gap-4">
                {/* Queue number */}
                <div className="flex-shrink-0 w-16 text-center">
                  <div className="code-text text-4xl font-black text-amber-400 leading-none">
                    #{order.queueNumber ?? "?"}
                  </div>
                  <div className={`text-[9px] font-bold uppercase tracking-wider mt-1 ${u.color}`}>{u.label}</div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {order.whatsappMessageType === "voice" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                        <Mic className="h-3 w-3" />Voice Note
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        <MessageSquare className="h-3 w-3" />Text
                      </span>
                    )}
                    {!order.autoReplySent && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">Auto-reply failed</span>
                    )}
                  </div>

                  {/* Phone */}
                  {order.customerPhoneDirect && (
                    <a href={`tel:${order.customerPhoneDirect}`} className="flex items-center gap-1.5 text-sm text-zinc-300 hover:text-amber-400 transition-colors mb-1.5">
                      <Phone className="h-3.5 w-3.5 text-zinc-600" />{order.customerPhoneDirect}
                    </a>
                  )}

                  {/* Name if known */}
                  {order.customerNameDirect && (
                    <div className="flex items-center gap-1.5 text-sm text-zinc-400 mb-1.5">
                      <User className="h-3.5 w-3.5 text-zinc-600" />{order.customerNameDirect}
                    </div>
                  )}

                  {/* Elapsed */}
                  <div className={`flex items-center gap-1 text-xs ${u.color}`}>
                    <Clock className="h-3 w-3" />
                    {mins < 60 ? `${mins} min ago` : `${Math.floor(mins/60)}h ${mins%60}m ago`}
                  </div>

                  {/* Voice player */}
                  {order.whatsappMediaUrl && (
                    <div className="mt-2">
                      <audio controls className="cinema-audio w-full" style={{ height: "32px" }}>
                        <source src={`${BASE}/api/whatsapp/media?url=${encodeURIComponent(order.whatsappMediaUrl)}`} />
                      </audio>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex-shrink-0 flex flex-col gap-2">
                  {isClaimed ? (
                    <div className="text-xs text-zinc-600 italic text-right">Being handled</div>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        className="font-bold text-black text-xs whitespace-nowrap"
                        style={{ background: "hsl(38 88% 52%)" }}
                        disabled={claimPending[order.id]}
                        onClick={() => claim(order)}
                      >
                        {claimPending[order.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isMine ? "Continue" : "Take This Order"}
                      </Button>
                      <button
                        onClick={() => { setDismissingId(order.id); setDismissReason(""); }}
                        className="text-xs text-zinc-600 hover:text-red-400 transition-colors text-center"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Dismissed section */}
        {dismissed.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setShowDismissed(s => !s)}
              className="flex items-center gap-2 text-zinc-600 hover:text-zinc-400 transition-colors text-sm font-semibold mb-3"
            >
              {showDismissed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Dismissed Today ({dismissed.length})
            </button>
            {showDismissed && (
              <div className="space-y-2">
                {dismissed.map(o => (
                  <div key={o.id} className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-dashed opacity-50"
                    style={{ borderColor: "hsl(0 0% 14%)", background: "hsl(0 0% 5%)" }}>
                    <span className="code-text text-zinc-500 text-sm">#{o.queueNumber}</span>
                    <span className="text-xs text-zinc-600">{o.customerPhoneDirect}</span>
                    <span className="text-xs text-red-800">Dismissed</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dismiss dialog */}
      {dismissingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="cinema-card rounded-2xl p-6 w-full max-w-sm mx-4">
            <h3 className="cinema-title-sm text-amber-400 text-base mb-4">Dismiss Entry</h3>
            <div className="space-y-3">
              <Label className="text-zinc-400 text-xs uppercase tracking-wider">Reason (required)</Label>
              <Input
                value={dismissReason}
                onChange={e => setDismissReason(e.target.value)}
                placeholder="Spam / wrong number / customer cancelled..."
                className="border-zinc-700/60"
                style={{ background: "hsl(0 0% 7%)" }}
              />
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setDismissingId(null)} className="flex-1 h-9 text-sm border border-zinc-700 text-zinc-400 rounded-lg hover:border-zinc-600 transition-colors">Cancel</button>
              <button
                onClick={dismissOrder}
                disabled={!dismissReason.trim()}
                className="flex-1 h-9 text-sm bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-40"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
