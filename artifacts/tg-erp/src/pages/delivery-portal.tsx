import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useSocket } from "@/hooks/use-socket";
import { useAttendance } from "@/hooks/use-attendance";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Truck, Plus, Phone, MapPin, LogOut, Wifi, WifiOff,
  CheckCircle2, XCircle, Package, Bell, ExternalLink, BarChart2, Radio,
  AlertCircle, Copy, Star,
} from "lucide-react";
import { MyTasks } from "@/components/my-tasks";
import { getApiBase } from "@/lib/api-base";

interface MenuItem {
  id: number; nameEn: string; nameAm: string; priceAed: number; available: boolean; categoryId: number; photoUrl?: string | null;
}
interface Category { id: number; nameEn: string }
interface CartItem { menuItemId: number; name: string; quantity: number; unitPrice: number }
interface DeliveryOrder {
  id: number; orderCode: string; status: string; channel: string;
  customerName: string | null; customerPhone: string | null; deliveryAddress: string | null;
  relayedByUserId: number | null; assignedDeliveryUserId: number | null;
  staffName: string | null; claimedAt: string | null;
  markedReadyAt: string | null;
  luckyNumber: number | null;
  items: { menuItemName: string | null; quantity: number }[];
  totalAed: number; createdAt: string; updatedAt?: string;
}

const BASE = getApiBase();
function getToken() { return localStorage.getItem("tg_erp_token"); }

async function apiFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.status.toString());
    throw new Error(errText || String(res.status));
  }
  return res.json();
}

function playReadyAlert() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const freqs = [523, 659, 784, 1047]; let t = ctx.currentTime;
    freqs.forEach(freq => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = "sine";
      gain.gain.setValueAtTime(0.3, t); gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.start(t); osc.stop(t + 0.2); t += 0.22;
    });
  } catch { /* ignore */ }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    ready: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    assigned: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    out_for_delivery: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    delivered: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold capitalize ${map[status] ?? "border-zinc-700 text-zinc-400"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const EMPTY_RELAY = { customerName: "", customerPhone: "", deliveryAddress: "" };

export default function DeliveryPortal() {
  const { user, logout, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [socketConnected, setSocketConnected] = useState(false);
  const [activeTab, setActiveTab] = useState("relay");

  const [relayForm, setRelayForm] = useState(EMPTY_RELAY);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCat, setSelectedCat] = useState<number | null>(null);

  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [actionPending, setActionPending] = useState<Record<number, boolean>>({});
  const [todayStats, setTodayStats] = useState({ completed: 0, commission: 0 });
  const prevReadyCountRef = useRef(0);
  const [lastLucky, setLastLucky] = useState<{ orderCode: string; luckyNumber: number | null; customerName: string; customerPhone: string } | null>(null);

  const socket = useSocket({ branchId: user?.branchId ?? undefined, userId: user?.id });
  const isDeliveryStaff = !!user && ["delivery_staff", "super_admin", "branch_manager"].includes(user.role);
  useAttendance(isDeliveryStaff, user?.branchId);

  useEffect(() => {
    if (user && user.role !== "delivery_staff" && user.role !== "super_admin" && user.role !== "branch_manager") {
      setLocation("/dashboard");
    }
  }, [user, setLocation]);

  const fetchMenu = useCallback(async () => {
    try {
      const [cats, items] = await Promise.all([
        apiFetch("/api/menu/categories"),
        apiFetch("/api/menu/items"),
      ]);
      setCategories(cats);
      setMenuItems(items);
    } catch { /* ignore */ }
  }, []);

  const fetchOrders = useCallback(async () => {
    setLoadingOrders(true);
    try {
      const params = new URLSearchParams();
      if (user?.branchId) params.set("branchId", String(user.branchId));
      // includeHistory=true so we get delivered/failed orders for the lucky number copy feature
      params.set("includeHistory", "true");
      const data: DeliveryOrder[] = await apiFetch(`/api/delivery/queue?${params}`);
      setOrders(data);
      const today = new Date().toDateString();
      const todayDone = data.filter(o => o.status === "delivered" && new Date(o.createdAt).toDateString() === today
        && (o.assignedDeliveryUserId === user?.id || o.relayedByUserId === user?.id));
      setTodayStats({ completed: todayDone.length, commission: todayDone.length * 5 });
      const readyCount = data.filter(o => o.status === "ready" && !o.assignedDeliveryUserId).length;
      if (readyCount > prevReadyCountRef.current) playReadyAlert();
      prevReadyCountRef.current = readyCount;
    } catch { /* ignore */ }
    setLoadingOrders(false);
  }, [user?.branchId, user?.id]);

  useEffect(() => { fetchMenu(); }, [fetchMenu]);
  useEffect(() => {
    fetchOrders();
    const iv = setInterval(fetchOrders, 8000);
    return () => clearInterval(iv);
  }, [fetchOrders]);

  useEffect(() => {
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("order:ready_pool", (data: { orderId: number; orderCode: string; customerName?: string }) => {
      playReadyAlert();
      toast({ title: `Order ${data.orderCode} Ready!`, description: `${data.customerName ?? "Customer"} — claim it now` });
      setActiveTab("deliveries");
      fetchOrders();
    });
    socket.on("order:ready", (data: { orderId: number; orderCode: string; customerName?: string }) => {
      // Every rider on the branch is notified — ready orders are a shared pool,
      // not routed only to whoever relayed the order.
      playReadyAlert();
      toast({ title: `Order ${data.orderCode} is Ready!`, description: `${data.customerName ?? "Customer"} — claim it now` });
      setActiveTab("deliveries");
      fetchOrders();
    });
    socket.on("order:claimed", ({ orderId }: { orderId: number }) => {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: "assigned" } : o));
    });
    socket.on("order:status", ({ orderId, status }: { orderId: number; status: string }) => {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
    });
    return () => {
      socket.off("order:ready_pool");
      socket.off("order:ready");
      socket.off("order:claimed");
      socket.off("order:status");
    };
  }, [socket, toast, user?.id, fetchOrders]);

  // Show ALL items; unavailable ones get a grey overlay and can't be added
  const filteredItems = menuItems.filter(i =>
    (!selectedCat || i.categoryId === selectedCat) &&
    (!searchQuery || i.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) || (i.nameAm && i.nameAm.includes(searchQuery)))
  );

  const addToCart = (item: MenuItem) => {
    if (!item.available) {
      toast({ title: "Item unavailable", description: `${item.nameEn} is currently not available`, variant: "destructive" });
      return;
    }
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id);
      if (existing) return prev.map(c => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, name: item.nameEn, quantity: 1, unitPrice: item.priceAed }];
    });
  };
  const removeFromCart = (menuItemId: number) => setCart(prev => prev.filter(c => c.menuItemId !== menuItemId));
  const cartTotal = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const submitRelay = async () => {
    if (!relayForm.customerName || !relayForm.customerPhone || cart.length === 0) return;
    if (!user?.branchId) {
      toast({ title: "No branch assigned", description: "Your account has no branch. Contact admin.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await apiFetch("/api/orders", "POST", {
        branchId: user.branchId,
        channel: "whatsapp_relay",
        customerNameDirect: relayForm.customerName,
        customerPhoneDirect: relayForm.customerPhone,
        deliveryAddress: relayForm.deliveryAddress,
        items: cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity, unitPrice: c.unitPrice })),
      });
      setLastCode(result.orderCode);
      setRelayForm(EMPTY_RELAY);
      setCart([]);
      toast({ title: "Order sent to kitchen!", description: `Code: ${result.orderCode}` });
      // Fetch the lucky number generated for this order (retry up to 3×, 1.5s apart)
      const orderId = result.id;
      const orderCode = result.orderCode;
      const snapName = relayForm.customerName;
      const snapPhone = relayForm.customerPhone;
      setLastLucky({ orderCode, luckyNumber: null, customerName: snapName, customerPhone: snapPhone });
      (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 1500));
          try {
            const params = new URLSearchParams();
            if (user?.branchId) params.set("branchId", String(user.branchId));
            const entries = await apiFetch(`/api/lottery/entries?${params}`);
            const entry = Array.isArray(entries) ? entries.find((e: { orderId: number; luckyNumber: number }) => e.orderId === orderId) : null;
            if (entry?.luckyNumber) {
              setLastLucky({ orderCode, luckyNumber: entry.luckyNumber, customerName: snapName, customerPhone: snapPhone });
              break;
            }
          } catch { /* keep retrying */ }
        }
      })();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Could not submit order", description: msg.includes("400") ? "Check all required fields" : msg, variant: "destructive" });
    }
    setSubmitting(false);
  };

  const claim = async (id: number) => {
    setActionPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/delivery/orders/${id}/claim`, "POST", {});
      fetchOrders();
      toast({ title: "Order claimed", description: "Head to pickup" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      toast({ title: "Could not claim", description: msg.includes("409") ? "Another rider just claimed it" : "Try again", variant: "destructive" });
    }
    setActionPending(p => ({ ...p, [id]: false }));
  };

  const pickup = async (id: number) => {
    setActionPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/delivery/orders/${id}/pickup`, "POST", {});
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: "out_for_delivery" } : o));
      toast({ title: "Picked up", description: "On the road 🛵" });
    } catch {
      toast({ title: "Error", description: "Could not update", variant: "destructive" });
    }
    setActionPending(p => ({ ...p, [id]: false }));
  };

  const complete = async (id: number, outcome: "delivered" | "failed") => {
    setActionPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/delivery/orders/${id}/complete`, "POST", { outcome });
      setOrders(prev => prev.map(o => o.id === id ? { ...o, status: outcome } : o));
      toast({ title: outcome === "delivered" ? "Delivered! 🎉" : "Marked failed", description: "Loop closed" });
      fetchOrders();
    } catch {
      toast({ title: "Error", description: "Could not update", variant: "destructive" });
    }
    setActionPending(p => ({ ...p, [id]: false }));
  };

  // Ready-but-unclaimed orders are a shared pool: EVERY deliveryman on the branch sees
  // every one of them — including ones they themselves relayed — so any available rider
  // can claim it. Nobody "owns" a ready order until they hit Claim.
  const readyToClaim = orders.filter(o => o.status === "ready" && !o.assignedDeliveryUserId);
  // Once claimed, the order belongs to that rider and moves into their own active list.
  const active = orders.filter(o => o.assignedDeliveryUserId === user?.id && ["assigned", "out_for_delivery"].includes(o.status));
  // History: orders this rider delivered, or relayed themselves (so they can see how their own relay turned out).
  // Use updatedAt (= last status-change time) as the delivery-completion timestamp
  // since createdAt is the order creation time, not when it was delivered.
  const recentlyDelivered = orders.filter(o => o.status === "delivered"
    && (o.assignedDeliveryUserId === user?.id || o.relayedByUserId === user?.id)
    && new Date(o.updatedAt ?? o.createdAt).toDateString() === new Date().toDateString());

  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "hsl(0 0% 4%)" }}>
      <div className="cinema-title text-2xl animate-pulse">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen text-white flex flex-col" style={{ background: "hsl(0 0% 4%)" }}>
      {/* ── HEADER ── */}
      <header className="portal-header sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ background: "hsl(38 50% 12%)", border: "1px solid hsl(38 88% 52% / 0.4)" }}>
            <Truck className="h-4.5 w-4.5 text-amber-400" />
          </div>
          <div>
            <div className="cinema-title-sm text-amber-400 text-sm">Field Operations</div>
            <div className="cinema-subtitle">{user?.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/deliveries"
            className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors text-zinc-400 border-zinc-700 hover:text-amber-400 hover:border-amber-500/40"
            title="Open Mission Control"
          >
            <BarChart2 className="h-3.5 w-3.5" /><span>Mission Control</span><ExternalLink className="h-3 w-3 opacity-50" />
          </a>
          <div className={`live-badge ${socketConnected ? "" : "opacity-50"}`}>
            {socketConnected ? <><span className="status-dot status-dot-live" />Live</> : <><WifiOff className="h-3 w-3" />Offline</>}
          </div>
          <button onClick={logout} className="text-zinc-600 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-950/20 transition-colors">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="px-4 pt-3 max-w-2xl mx-auto w-full">
        <MyTasks socket={socket} />
      </div>

      {/* Stats bar */}
      <div className="border-y px-4 py-2 flex gap-6 text-sm" style={{ borderColor: "hsl(0 0% 10%)", background: "hsl(0 0% 5%)" }}>
        <span className="text-zinc-600 text-xs">Today: <span className="font-black text-zinc-200">{todayStats.completed}</span> delivered</span>
        <span className="text-zinc-600 text-xs">Commission: <span className="font-black text-amber-400">{todayStats.commission} AED</span></span>
        {readyToClaim.length > 0 && (
          <span className="flex items-center gap-1 text-emerald-400 font-bold text-xs animate-pulse">
            <Bell className="h-3 w-3" />{readyToClaim.length} ready to claim
          </span>
        )}
        {active.length > 0 && (
          <a href="/deliveries" className="ml-auto flex items-center gap-1 text-xs text-amber-400/70 hover:text-amber-400 transition-colors">
            <Radio className="h-3 w-3" />View all in Mission Control
          </a>
        )}
      </div>

      {/* ── TABS ── */}
      <main className="flex-1 max-w-2xl mx-auto w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full rounded-none border-b bg-transparent h-auto p-0" style={{ borderColor: "hsl(0 0% 10%)" }}>
            <TabsTrigger value="relay" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-amber-500 data-[state=active]:text-amber-400 py-3 font-semibold bg-transparent text-zinc-500 text-sm">
              <Plus className="h-3.5 w-3.5 mr-1.5" />Relay Order
            </TabsTrigger>
            <TabsTrigger value="deliveries" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-amber-500 data-[state=active]:text-amber-400 py-3 font-semibold bg-transparent text-zinc-500 text-sm relative">
              <Truck className="h-3.5 w-3.5 mr-1.5" />My Deliveries
              {active.length > 0 && (
                <span className="absolute top-2 right-5 h-4 w-4 rounded-full bg-amber-500 text-black text-[10px] font-black flex items-center justify-center">
                  {active.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── RELAY TAB ── */}
          <TabsContent value="relay" className="p-4 space-y-5">
            {lastCode && (
              <div className="space-y-2">
                {/* Order confirmation */}
                <div className="cinema-card rounded-xl p-4 flex items-center justify-between" style={{ background: "hsl(142 30% 6%)", borderColor: "hsl(142 50% 20%)" }}>
                  <div>
                    <div className="text-emerald-400 font-bold text-xs uppercase tracking-wider mb-0.5">Order sent to kitchen!</div>
                    <div className="code-text text-2xl text-emerald-300">{lastCode}</div>
                  </div>
                  <button onClick={() => { setLastCode(null); setLastLucky(null); }} className="text-xs text-zinc-500 hover:text-white px-2 py-1 rounded border border-zinc-700 transition-colors">Dismiss</button>
                </div>

                {/* Lucky number copy card */}
                {lastLucky && lastLucky.luckyNumber !== null && (
                  <div className="rounded-xl p-4 space-y-3" style={{ background: "hsl(38 60% 6%)", border: "1px solid hsl(38 88% 52% / 0.35)" }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Star className="h-4 w-4 text-amber-400" />
                      <span className="text-amber-400 font-bold text-xs uppercase tracking-wider">Lucky Number Ready — Copy &amp; Send to Customer</span>
                    </div>

                    {/* The lucky number displayed large */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-zinc-500 text-xs mb-0.5">Lucky Number</div>
                        <div className="code-text text-4xl font-black text-amber-400 tracking-widest">{lastLucky.luckyNumber}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-zinc-500 text-xs mb-0.5">Order</div>
                        <div className="code-text text-sm text-zinc-300">{lastLucky.orderCode}</div>
                      </div>
                    </div>

                    {/* Preview of the message */}
                    <div className="rounded-lg p-3 text-xs text-zinc-300 leading-relaxed" style={{ background: "hsl(0 0% 6%)", border: "1px solid hsl(0 0% 12%)" }}>
                      <p className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1.5 font-bold">Message Preview</p>
                      <p>
                        Thank you for ordering from TG's Restaurant! 🍽️<br />
                        Your order <span className="text-emerald-400 font-bold">{lastLucky.orderCode}</span> is being prepared.<br />
                        Your Lucky Number is <span className="text-amber-400 font-black text-sm">{lastLucky.luckyNumber}</span> 🎉<br />
                        <span className="text-zinc-500">ከቲጂ ምግብ ቤት አዘዝህ! ትዕዛዝ {lastLucky.orderCode} እየተዘጋጀ ነው። የዕድለኛ ቁጥርህ {lastLucky.luckyNumber} ነው 🎉</span>
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        const msg = `Thank you for ordering from TG's Restaurant! 🍽️\nYour order ${lastLucky.orderCode} is being prepared.\nYour Lucky Number is ${lastLucky.luckyNumber} 🎉\n\nከቲጂ ምግብ ቤት አዘዝህ! ትዕዛዝ ${lastLucky.orderCode} እየተዘጋጀ ነው። የዕድለኛ ቁጥርህ ${lastLucky.luckyNumber} ነው 🎉`;
                        navigator.clipboard.writeText(msg).then(() =>
                          toast({ title: "Copied!", description: "Paste it into WhatsApp for the customer" })
                        );
                      }}
                      className="w-full flex items-center justify-center gap-2 h-10 rounded-lg font-bold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
                      style={{ background: "hsl(38 88% 52%)", color: "hsl(0 0% 4%)" }}
                    >
                      <Copy className="h-4 w-4" />
                      Copy Message for Customer
                    </button>
                  </div>
                )}

                {/* Lucky number still loading */}
                {lastLucky && lastLucky.luckyNumber === null && (
                  <div className="rounded-xl p-3 flex items-center gap-2 text-xs text-zinc-500" style={{ background: "hsl(38 20% 5%)", border: "1px solid hsl(38 88% 52% / 0.15)" }}>
                    <Star className="h-3.5 w-3.5 text-amber-600" />
                    Lucky number will appear here once kitchen confirms the order
                  </div>
                )}
              </div>
            )}

            {/* Customer info */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Customer Name *</Label>
                <Input value={relayForm.customerName} onChange={e => setRelayForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Full name..." className="border-zinc-700/60 focus:border-amber-500/50" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Phone Number *</Label>
                <Input value={relayForm.customerPhone} onChange={e => setRelayForm(f => ({ ...f, customerPhone: e.target.value }))} placeholder="+971..." className="border-zinc-700/60 focus:border-amber-500/50" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Delivery Address</Label>
                <Input value={relayForm.deliveryAddress} onChange={e => setRelayForm(f => ({ ...f, deliveryAddress: e.target.value }))} placeholder="Street, building, flat..." className="border-zinc-700/60 focus:border-amber-500/50" style={{ background: "hsl(0 0% 7%)" }} />
              </div>
            </div>

            {/* Menu — ALL items with availability indicator */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Select Items *</Label>
                <div className="flex items-center gap-3 text-[10px] text-zinc-600">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Available</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-zinc-700" />Unavailable</span>
                </div>
              </div>
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search menu..." className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }} />
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                <button onClick={() => setSelectedCat(null)} className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${selectedCat === null ? "bg-amber-500 text-black border-amber-500" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50 hover:text-zinc-200"}`}>All</button>
                {categories.map(c => (
                  <button key={c.id} onClick={() => setSelectedCat(c.id)} className={`whitespace-nowrap text-xs px-3 py-1.5 rounded-full border font-semibold transition-colors ${selectedCat === c.id ? "bg-amber-500 text-black border-amber-500" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50 hover:text-zinc-200"}`}>{c.nameEn}</button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {filteredItems.map(item => {
                  const inCart = cart.find(c => c.menuItemId === item.id);
                  const unavailable = !item.available;
                  return (
                    <button
                      key={item.id}
                      onClick={() => addToCart(item)}
                      disabled={unavailable}
                      className={`text-left rounded-xl border transition-all relative overflow-hidden ${
                        unavailable
                          ? "border-zinc-800/50 opacity-50 cursor-not-allowed"
                          : inCart
                            ? "border-amber-500/60 bg-amber-950/20"
                            : "border-zinc-800 hover:border-amber-500/30"
                      }`}
                      style={{ background: unavailable ? "hsl(0 0% 5%)" : inCart ? undefined : "hsl(0 0% 6%)" }}
                    >
                      {item.photoUrl && (
                        <img src={item.photoUrl} alt={item.nameEn} className="w-full h-20 object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      )}
                      <div className="p-3">
                        {unavailable && (
                          <span className="absolute top-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-900/60 text-red-400 border border-red-700/30">
                            Unavailable
                          </span>
                        )}
                        <div className="font-semibold text-sm text-zinc-100 leading-tight pr-4">{item.nameEn}</div>
                        {item.nameAm && <div className="text-[10px] text-zinc-600">{item.nameAm}</div>}
                        <div className="flex items-center justify-between mt-1.5">
                          <span className={`font-bold text-sm ${unavailable ? "text-zinc-600" : "text-amber-400"}`}>{item.priceAed} AED</span>
                          {inCart && <span className="text-amber-400 font-black text-sm">×{inCart.quantity}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {filteredItems.length === 0 && (
                  <div className="col-span-2 text-center py-8 text-zinc-600 text-sm">No items match search</div>
                )}
              </div>
            </div>

            {/* Cart */}
            {cart.length > 0 && (
              <div className="cinema-card rounded-xl p-4 space-y-2">
                <h4 className="font-bold text-zinc-200 text-sm flex items-center gap-2"><Package className="h-3.5 w-3.5 text-amber-400" />Cart</h4>
                {cart.map(i => (
                  <div key={i.menuItemId} className="flex justify-between items-center text-sm">
                    <span className="text-zinc-300">{i.name} <span className="text-zinc-600">×{i.quantity}</span></span>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-zinc-100">{(i.quantity * i.unitPrice).toFixed(0)} AED</span>
                      <button onClick={() => removeFromCart(i.menuItemId)} className="text-zinc-600 hover:text-red-400 transition-colors text-xs">✕</button>
                    </div>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between font-black text-base" style={{ borderColor: "hsl(0 0% 12%)" }}>
                  <span className="text-zinc-300">Total</span>
                  <span className="text-amber-400">{cartTotal.toFixed(2)} AED</span>
                </div>
              </div>
            )}

            {!user?.branchId && (
              <div className="flex items-center gap-2 text-xs text-amber-400 p-3 rounded-lg border border-amber-500/20 bg-amber-950/10">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                No branch assigned to your account. Contact admin before placing orders.
              </div>
            )}

            <Button
              className="w-full h-12 text-sm font-black rounded-xl transition-all"
              style={{ background: "hsl(38 88% 52%)", color: "hsl(0 0% 4%)" }}
              disabled={submitting || !relayForm.customerName || !relayForm.customerPhone || cart.length === 0 || !user?.branchId}
              onClick={submitRelay}
            >
              {submitting ? "Sending to Kitchen..." : "🚀 Send to Kitchen"}
            </Button>
          </TabsContent>

          {/* ── DELIVERIES TAB ── */}
          <TabsContent value="deliveries" className="p-4 space-y-5">
            {readyToClaim.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="font-bold text-emerald-400 flex items-center gap-2 text-sm">
                  <Bell className="h-4 w-4 animate-pulse" />Ready to Claim ({readyToClaim.length})
                </h3>
                {readyToClaim.map(order => (
                  <div key={order.id} className="queue-card" data-urgency="ok" style={{ borderLeftColor: "hsl(142 70% 45%)" }}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="code-text text-xl text-emerald-400">{order.orderCode}</div>
                        <div className="text-sm font-semibold text-zinc-200">{order.customerName}</div>
                        {order.deliveryAddress && (
                          <div className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" />{order.deliveryAddress}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <StatusPill status={order.status} />
                        <div className="text-xs text-amber-400 font-bold mt-1">{order.totalAed} AED</div>
                      </div>
                    </div>
                    <div className="text-xs text-zinc-600 mb-2">{order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(", ")}</div>
                    <Button
                      size="sm" className="w-full h-9 text-xs font-bold"
                      style={{ background: "hsl(142 60% 30%)", color: "white" }}
                      disabled={actionPending[order.id]}
                      onClick={() => claim(order.id)}
                    >
                      {actionPending[order.id] ? "..." : "✋ Claim This Order"}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {active.length > 0 ? (
              <div className="space-y-2.5">
                <h3 className="font-bold text-amber-400 flex items-center gap-2 text-sm">
                  <Truck className="h-4 w-4" />My Active Orders ({active.length})
                </h3>
                {active.map(order => (
                  <div key={order.id} className="queue-card" style={{ borderLeftColor: order.status === "assigned" ? "hsl(38 88% 52%)" : "hsl(220 80% 60%)" }}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="code-text text-xl text-amber-400">{order.orderCode}</div>
                        <div className="text-sm font-semibold text-zinc-200">{order.customerName}</div>
                        {order.customerPhone && (
                          <a href={`tel:${order.customerPhone}`} className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                            <Phone className="h-3 w-3" />{order.customerPhone}
                          </a>
                        )}
                        {order.deliveryAddress && (
                          <a
                            href={`https://maps.google.com/?q=${encodeURIComponent(order.deliveryAddress)}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-zinc-500 flex items-center gap-1 hover:text-amber-400 transition-colors"
                          >
                            <MapPin className="h-3 w-3" />{order.deliveryAddress}
                          </a>
                        )}
                      </div>
                      <div className="text-right">
                        <StatusPill status={order.status} />
                        <div className="text-xs text-amber-400 font-bold mt-1">{order.totalAed} AED</div>
                      </div>
                    </div>
                    <div className="text-xs text-zinc-600 mb-3">{order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(", ")}</div>
                    <div className="flex gap-2">
                      {order.status === "assigned" && (
                        <Button size="sm" className="flex-1 h-9 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white" disabled={actionPending[order.id]} onClick={() => pickup(order.id)}>
                          {actionPending[order.id] ? "..." : "🛵 Picked Up"}
                        </Button>
                      )}
                      {order.status === "out_for_delivery" && (
                        <>
                          <Button size="sm" className="flex-1 h-9 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1" disabled={actionPending[order.id]} onClick={() => complete(order.id, "delivered")}>
                            <CheckCircle2 className="h-3.5 w-3.5" />{actionPending[order.id] ? "..." : "Delivered"}
                          </Button>
                          <Button size="sm" variant="outline" className="h-9 px-3 text-xs font-bold border-red-500/30 text-red-400 hover:bg-red-950/20 flex items-center gap-1" disabled={actionPending[order.id]} onClick={() => complete(order.id, "failed")}>
                            <XCircle className="h-3.5 w-3.5" />Failed
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Truck className="h-10 w-10 text-zinc-700" />
                <p className="text-zinc-500 text-sm font-medium">No active deliveries</p>
                <p className="text-zinc-700 text-xs text-center">Claim a ready order above, or relay a WhatsApp customer order from the Relay tab</p>
              </div>
            )}

            {/* ── TODAY'S DELIVERED ORDERS (lucky number copy) ── */}
            {recentlyDelivered.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="font-bold text-zinc-500 flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-zinc-600" />Today's Delivered ({recentlyDelivered.length})
                </h3>
                {recentlyDelivered.map(order => {
                  const hasLucky = order.luckyNumber !== null && order.luckyNumber !== undefined;
                  const buildLuckyMsg = () => {
                    const name = order.customerName ?? "Customer";
                    const num = order.luckyNumber;
                    return `🎉 ሰላም ${name}!\nእርስዎ ዛሬ ዕድለኛ ቁጥር ${num} ደርሷቸዋል!\nOrder: ${order.orderCode}\n\n🎉 Hi ${name}!\nYour lucky number today is ${num}!\nOrder: ${order.orderCode}`;
                  };
                  const copyLucky = async () => {
                    try {
                      await navigator.clipboard.writeText(buildLuckyMsg());
                      toast({ title: "📋 Copied!", description: `Lucky number message for ${order.orderCode}` });
                    } catch {
                      toast({ title: "Copy failed", description: "Use long-press to copy manually", variant: "destructive" });
                    }
                  };
                  return (
                    <div key={order.id} className="queue-card opacity-75" style={{ borderLeftColor: "hsl(0 0% 25%)" }}>
                      <div className="flex justify-between items-start mb-1.5">
                        <div>
                          <div className="code-text text-lg text-zinc-400">{order.orderCode}</div>
                          <div className="text-sm text-zinc-500">{order.customerName}</div>
                        </div>
                        <div className="text-right">
                          <StatusPill status={order.status} />
                          <div className="text-xs text-zinc-600 mt-1">{order.totalAed} AED</div>
                        </div>
                      </div>
                      {hasLucky && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-8 text-xs font-bold border-amber-500/30 text-amber-400 hover:bg-amber-950/20"
                          onClick={copyLucky}
                        >
                          <Star className="h-3 w-3 mr-1.5" />
                          📋 Copy Lucky Number Message (#{order.luckyNumber})
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {readyToClaim.length === 0 && active.length === 0 && recentlyDelivered.length === 0 && (
              loadingOrders ? (
                <div className="text-center py-6 text-zinc-600 text-xs animate-pulse">Checking for orders...</div>
              ) : null
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
