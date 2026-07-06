import { useEffect, useState, useCallback } from "react";
import { useSocket } from "@/hooks/use-socket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShoppingBag, MapPin, Phone, User, CheckCircle2, Clock, ChefHat, Truck, Star } from "lucide-react";

interface MenuItem { id: number; nameEn: string; nameAm: string; priceAed: number; available: boolean; categoryId: number; photoUrl?: string }
interface Category { id: number; nameEn: string; nameAm: string }
interface CartItem { menuItemId: number; name: string; nameAm: string; quantity: number; unitPrice: number }

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
async function apiFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const STATUS_STEPS = [
  { key: "pending_acceptance", label: "Order Received", icon: ShoppingBag },
  { key: "preparing", label: "Chef Preparing", icon: ChefHat },
  { key: "ready", label: "Ready for Pickup", icon: CheckCircle2 },
  { key: "out_for_delivery", label: "On the Way", icon: Truck },
  { key: "delivered", label: "Delivered", icon: Star },
];

function stepIndex(status: string) {
  const idx = STATUS_STEPS.findIndex(s => s.key === status);
  return idx === -1 ? 0 : idx;
}

export default function OrderPublic() {
  const [step, setStep] = useState<"menu" | "confirm" | "tracking">("menu");
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });
  const [selectedCat, setSelectedCat] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [orderCode, setOrderCode] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string>("pending_acceptance");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socket = useSocket();

  useEffect(() => {
    (async () => {
      try {
        const [cats, items] = await Promise.all([apiFetch("/api/menu/categories"), apiFetch("/api/menu/items")]);
        setCategories(cats);
        setMenuItems(items.filter((i: MenuItem) => i.available));
      } catch { /* ignore */ }
    })();
  }, []);

  // Track order status via socket
  useEffect(() => {
    if (!orderCode) return;
    socket.emit("join:order", orderCode);
    socket.on("order:status_public", ({ status }: { status: string }) => setOrderStatus(status));
    return () => { socket.off("order:status_public"); };
  }, [socket, orderCode]);

  const addToCart = (item: MenuItem) => {
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id);
      if (existing) return prev.map(c => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, name: item.nameEn, nameAm: item.nameAm, quantity: 1, unitPrice: item.priceAed }];
    });
  };
  const updateQty = (menuItemId: number, delta: number) => {
    setCart(prev => prev.map(c => c.menuItemId === menuItemId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0));
  };
  const cartTotal = cart.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const filteredItems = menuItems.filter(i => !selectedCat || i.categoryId === selectedCat);

  const submitOrder = async () => {
    if (!form.name || !form.phone || cart.length === 0) return;
    setSubmitting(true); setError(null);
    try {
      const result = await apiFetch("/api/orders", "POST", {
        branchId: 1, // default branch; could be selected
        channel: "webapp",
        customerNameDirect: form.name,
        customerPhoneDirect: form.phone,
        deliveryAddress: form.address,
        items: cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity, unitPrice: c.unitPrice })),
      });
      setOrderCode(result.orderCode);
      setOrderId(result.id);
      setOrderStatus(result.status ?? "pending_acceptance");
      setStep("tracking");
    } catch { setError("Could not place order. Please try again."); }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Brand header */}
      <header className="border-b border-amber-900/30 bg-zinc-950/95 backdrop-blur sticky top-0 z-50 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
              <ShoppingBag className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <div className="font-black text-amber-400 leading-none">TG Restaurant</div>
              <div className="text-[11px] text-zinc-500">ቲጂ ምግብ ቤት</div>
            </div>
          </div>
          {step === "menu" && cart.length > 0 && (
            <button
              onClick={() => setStep("confirm")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-black font-bold text-sm hover:bg-amber-400 transition-colors"
            >
              <ShoppingBag className="h-4 w-4" />
              {cartCount} items · {cartTotal.toFixed(0)} AED
            </button>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">

        {/* MENU STEP */}
        {step === "menu" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-black text-white">Order Online</h1>
              <p className="text-zinc-500 text-sm mt-1">Fresh Ethiopian cuisine, delivered to you</p>
            </div>

            {/* Category filter */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button onClick={() => setSelectedCat(null)} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${selectedCat === null ? "bg-amber-500 text-black border-amber-500" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50"}`}>
                All
              </button>
              {categories.map(c => (
                <button key={c.id} onClick={() => setSelectedCat(c.id)} className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${selectedCat === c.id ? "bg-amber-500 text-black border-amber-500" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50"}`}>
                  {c.nameEn}
                </button>
              ))}
            </div>

            {/* Menu grid */}
            <div className="grid grid-cols-1 gap-3">
              {filteredItems.map(item => {
                const inCart = cart.find(c => c.menuItemId === item.id);
                return (
                  <div key={item.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 flex items-center justify-between gap-4">
                    {item.photoUrl && (
                      <img src={item.photoUrl} alt={item.nameEn} className="h-16 w-16 rounded-xl object-cover flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white">{item.nameEn}</div>
                      <div className="text-zinc-500 text-sm">{item.nameAm}</div>
                      <div className="text-amber-400 font-black mt-1">{item.priceAed} AED</div>
                    </div>
                    {inCart ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => updateQty(item.id, -1)} className="h-8 w-8 rounded-full border border-zinc-700 text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors font-bold">−</button>
                        <span className="font-black text-amber-400 w-5 text-center">{inCart.quantity}</span>
                        <button onClick={() => updateQty(item.id, 1)} className="h-8 w-8 rounded-full bg-amber-500 text-black font-bold hover:bg-amber-400 transition-colors">+</button>
                      </div>
                    ) : (
                      <button onClick={() => addToCart(item)} className="h-8 w-8 rounded-full bg-amber-500 text-black font-bold hover:bg-amber-400 transition-colors flex items-center justify-center">+</button>
                    )}
                  </div>
                );
              })}
            </div>

            {cart.length > 0 && (
              <div className="sticky bottom-4">
                <Button onClick={() => setStep("confirm")} className="w-full h-14 text-base font-black bg-amber-500 hover:bg-amber-400 text-black rounded-2xl shadow-lg shadow-amber-500/20">
                  Review Order · {cartTotal.toFixed(2)} AED →
                </Button>
              </div>
            )}
          </div>
        )}

        {/* CONFIRM STEP */}
        {step === "confirm" && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep("menu")} className="text-zinc-500 hover:text-white text-sm">← Back</button>
              <h2 className="text-xl font-black">Your Details</h2>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-zinc-300 flex items-center gap-1.5"><User className="h-4 w-4" />Your Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name..." className="bg-zinc-900 border-zinc-700 h-12" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300 flex items-center gap-1.5"><Phone className="h-4 w-4" />Phone Number *</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+971..." className="bg-zinc-900 border-zinc-700 h-12" />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300 flex items-center gap-1.5"><MapPin className="h-4 w-4" />Delivery Address</Label>
                <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street, building, flat..." className="bg-zinc-900 border-zinc-700 h-12" />
              </div>
            </div>

            {/* Order summary */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
              <h3 className="font-bold text-zinc-200">Order Summary</h3>
              {cart.map(i => (
                <div key={i.menuItemId} className="flex justify-between text-sm">
                  <span className="text-zinc-300">{i.name} <span className="text-zinc-600">×{i.quantity}</span></span>
                  <span className="font-bold text-white">{(i.quantity * i.unitPrice).toFixed(0)} AED</span>
                </div>
              ))}
              <div className="border-t border-zinc-800 pt-3 flex justify-between font-black text-lg">
                <span>Total</span>
                <span className="text-amber-400">{cartTotal.toFixed(2)} AED</span>
              </div>
            </div>

            {error && <div className="text-red-400 text-sm bg-red-950/30 border border-red-700/50 rounded-xl px-4 py-3">{error}</div>}

            <Button
              onClick={submitOrder}
              disabled={submitting || !form.name || !form.phone}
              className="w-full h-14 text-base font-black bg-amber-500 hover:bg-amber-400 text-black rounded-2xl"
            >
              {submitting ? "Placing Order..." : "Place Order →"}
            </Button>
          </div>
        )}

        {/* TRACKING STEP */}
        {step === "tracking" && orderCode && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="text-zinc-500 text-sm mb-2">Order placed successfully!</div>
              <div className="font-mono font-black text-4xl text-amber-400">{orderCode}</div>
              <div className="text-zinc-500 text-sm mt-1">Save this code to track your order</div>
            </div>

            {/* Progress tracker */}
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-1">
              <h3 className="font-bold text-zinc-200 mb-4">Live Status</h3>
              {STATUS_STEPS.map((s, i) => {
                const current = stepIndex(orderStatus);
                const isActive = i === current;
                const isDone = i < current;
                const Icon = s.icon;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${isActive ? "border-amber-500 bg-amber-500/20 scale-110" : isDone ? "border-green-600 bg-green-950/40" : "border-zinc-700 bg-zinc-900"}`}>
                      <Icon className={`h-4 w-4 ${isActive ? "text-amber-400" : isDone ? "text-green-400" : "text-zinc-600"}`} />
                    </div>
                    <div className="flex-1">
                      <div className={`text-sm font-semibold ${isActive ? "text-white" : isDone ? "text-green-400" : "text-zinc-600"}`}>{s.label}</div>
                      {isActive && <div className="text-xs text-amber-400 flex items-center gap-1"><Clock className="h-3 w-3" />In progress...</div>}
                    </div>
                    {isDone && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  </div>
                );
              }).reduce<React.ReactNode[]>((acc, el, i, arr) => {
                acc.push(el);
                if (i < arr.length - 1) acc.push(<div key={`line-${i}`} className="ml-4 h-4 w-0.5 bg-zinc-800" />);
                return acc;
              }, [])}
            </div>

            <div className="text-center space-y-3">
              <a href={`/track/${orderCode}`} className="text-amber-400 text-sm hover:underline block">
                Full tracking page → /track/{orderCode}
              </a>
              <Button variant="outline" onClick={() => { setStep("menu"); setCart([]); setForm({ name: "", phone: "", address: "" }); }} className="border-zinc-700 text-zinc-300 hover:border-amber-500">
                Place Another Order
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
