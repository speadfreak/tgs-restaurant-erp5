import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/hooks/use-socket";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Truck, Check, X, MapPin, Phone, Clock, Wifi, WifiOff,
  ExternalLink, RefreshCw, User, Radio, Package,
} from "lucide-react";

// Unified delivery interface — sourced from ordersTable via /api/delivery/queue
interface Delivery {
  id: number;
  orderCode: string;
  status: string;
  channel: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  relayedByUserId: number | null;
  assignedDeliveryUserId: number | null;
  staffName: string | null;
  claimedAt: string | null;
  items: { menuItemName: string | null; quantity: number }[];
  totalAed: number;
  createdAt: string;
  updatedAt: string;
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

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
  ready:            { label: "Ready for Pickup", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/40", dot: "bg-emerald-400" },
  assigned:         { label: "Assigned",         color: "text-blue-400",   bg: "bg-blue-500/10",    border: "border-blue-500/40",    dot: "bg-blue-400" },
  out_for_delivery: { label: "On the Road",      color: "text-amber-400",  bg: "bg-amber-500/10",   border: "border-amber-500/40",   dot: "bg-amber-400" },
  delivered:        { label: "Delivered",        color: "text-zinc-400",   bg: "bg-zinc-500/10",    border: "border-zinc-500/30",    dot: "bg-zinc-500" },
  failed:           { label: "Failed",           color: "text-red-400",    bg: "bg-red-500/10",     border: "border-red-500/40",     dot: "bg-red-500" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/30", dot: "bg-zinc-500" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const map: Record<string, { label: string; color: string }> = {
    whatsapp_relay: { label: "WhatsApp Relay", color: "text-green-400" },
    whatsapp_voice: { label: "Voice Order",    color: "text-blue-400" },
    webapp:         { label: "Web Order",      color: "text-zinc-400" },
  };
  const c = map[channel] ?? { label: channel, color: "text-zinc-500" };
  return <span className={`text-[10px] font-semibold uppercase tracking-wider ${c.color}`}>{c.label}</span>;
}

function elapsed(createdAt: string) {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}
function elapsedColor(createdAt: string, status: string) {
  if (["delivered", "failed"].includes(status)) return "text-zinc-600";
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins > 60) return "text-red-400";
  if (mins > 30) return "text-amber-400";
  return "text-zinc-500";
}

const FILTERS = ["all", "ready", "assigned", "out_for_delivery", "delivered", "failed"] as const;
type FilterKey = typeof FILTERS[number];

export default function Deliveries() {
  const { user } = useAuth();
  const { toast } = useToast();
  const socket = useSocket({ branchId: user?.branchId ?? undefined, userId: user?.id });
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [actionPending, setActionPending] = useState<Record<number, boolean>>({});
  const [tick, setTick] = useState(0);
  const lastFetchRef = useRef(0);

  const fetchDeliveries = useCallback(async () => {
    if (Date.now() - lastFetchRef.current < 3000) return;
    lastFetchRef.current = Date.now();
    setLoading(true);
    try {
      const params = new URLSearchParams({ includeHistory: "true" });
      if (user?.branchId) params.set("branchId", String(user.branchId));
      const data = await apiFetch(`/api/delivery/queue?${params}`);
      setDeliveries(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.branchId]);

  useEffect(() => {
    fetchDeliveries();
    const iv = setInterval(fetchDeliveries, 10000);
    return () => clearInterval(iv);
  }, [fetchDeliveries]);

  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  // Real-time socket updates
  useEffect(() => {
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("order:status", ({ orderId, status }: { orderId: number; status: string }) => {
      setDeliveries(prev => prev.map(d => d.id === orderId ? { ...d, status } : d));
    });
    socket.on("order:claimed", ({ orderId }: { orderId: number }) => {
      fetchDeliveries();
    });
    return () => {
      socket.off("connect"); socket.off("disconnect");
      socket.off("order:status"); socket.off("order:claimed");
    };
  }, [socket, fetchDeliveries]);

  // Mission Control can manage any delivery (assign riders, force-complete)
  const handlePickup = async (id: number) => {
    setActionPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/delivery/orders/${id}/pickup`, "POST", { userId: user?.id });
      setDeliveries(prev => prev.map(d => d.id === id ? { ...d, status: "out_for_delivery" } : d));
      toast({ title: "Status updated", description: "Order is on the road" });
    } catch {
      toast({ title: "Error", description: "Could not update", variant: "destructive" });
    }
    setActionPending(p => ({ ...p, [id]: false }));
  };

  const handleComplete = async (id: number, outcome: "delivered" | "failed") => {
    setActionPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/delivery/orders/${id}/complete`, "POST", { userId: user?.id, outcome });
      setDeliveries(prev => prev.map(d => d.id === id ? { ...d, status: outcome } : d));
      toast({ title: outcome === "delivered" ? "Marked as Delivered ✅" : "Marked as Failed", description: `Order closed` });
    } catch {
      toast({ title: "Error", description: "Could not update", variant: "destructive" });
    }
    setActionPending(p => ({ ...p, [id]: false }));
  };

  const filtered = deliveries.filter(d => filter === "all" || d.status === filter);

  const stats = {
    total: deliveries.length,
    active: deliveries.filter(d => ["assigned", "out_for_delivery", "ready"].includes(d.status)).length,
    onRoad: deliveries.filter(d => d.status === "out_for_delivery").length,
    done: deliveries.filter(d => d.status === "delivered").length,
    failed: deliveries.filter(d => d.status === "failed").length,
  };

  return (
    <div className="min-h-screen" style={{ background: "hsl(0 0% 4%)" }}>
      {/* ── HEADER ── */}
      <div className="border-b relative" style={{ borderColor: "hsl(38 30% 10%)", background: "hsl(0 0% 2%)" }}>
        <div className="absolute top-0 left-0 right-0 h-[1px]" style={{ background: "linear-gradient(90deg, transparent, hsl(38 88% 52% / 0.6), transparent)" }} />
        <div className="max-w-7xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: "hsl(38 50% 10%)", border: "1px solid hsl(38 88% 52% / 0.3)" }}>
                <Truck className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h1 className="cinema-title text-2xl">Mission Control</h1>
                <p className="cinema-subtitle mt-0.5">Delivery Operations — Live Feed</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`live-badge ${socketConnected ? "" : "opacity-50"}`}>
                {socketConnected ? <><span className="status-dot status-dot-live" />Live</> : <><WifiOff className="h-3 w-3" />Offline</>}
              </div>
              <a href="/delivery" className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors text-amber-400 border-amber-500/30 hover:bg-amber-500/10">
                <Radio className="h-3.5 w-3.5" />Field Portal
              </a>
              <button onClick={fetchDeliveries} disabled={loading} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-40">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center mt-5 rounded-xl overflow-hidden border" style={{ borderColor: "hsl(0 0% 12%)", background: "hsl(0 0% 5%)" }}>
            {[
              { label: "Total Today", value: stats.total, color: "text-zinc-300" },
              { label: "Active",      value: stats.active, color: "text-amber-400" },
              { label: "On the Road", value: stats.onRoad, color: "text-blue-400" },
              { label: "Delivered",   value: stats.done,   color: "text-emerald-400" },
              { label: "Failed",      value: stats.failed, color: "text-red-400" },
            ].map((s, i) => (
              <div key={s.label} className={`mission-stat flex-1 ${i > 0 ? "border-l" : ""}`} style={{ borderLeftColor: "hsl(0 0% 10%)" }}>
                <span className={`mission-stat-number ${s.color}`}>{s.value}</span>
                <span className="mission-stat-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FILTER TABS ── */}
      <div className="border-b sticky top-0 z-10 backdrop-blur-sm" style={{ borderColor: "hsl(0 0% 10%)", background: "hsl(0 0% 4% / 0.95)" }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-0 overflow-x-auto scrollbar-hide">
            {FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all whitespace-nowrap ${filter === f ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}
              >
                {f === "all" ? "All Deliveries" : f.replace(/_/g, " ")}
                {f !== "all" && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-black bg-zinc-800 text-zinc-500">
                    {deliveries.filter(d => d.status === f).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── DELIVERY CARDS ── */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        {loading && deliveries.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-3">
              <Truck className="h-10 w-10 text-amber-500/30 mx-auto animate-pulse" />
              <p className="cinema-subtitle">Loading deliveries...</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-3">
              <Truck className="h-12 w-12 text-zinc-700 mx-auto" />
              <p className="text-zinc-500 font-medium">No deliveries in this category</p>
              <p className="text-zinc-600 text-sm">Active deliveries appear here in real time</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4" key={tick}>
            {filtered.map(delivery => {
              const isActive = !["delivered", "failed"].includes(delivery.status);
              return (
                <div key={delivery.id} className={`cinema-card animate-slide-in-up ${!isActive ? "opacity-70" : ""}`}>
                  {/* Card header */}
                  <div className="p-4 pb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="code-text text-amber-400 text-base">{delivery.orderCode}</span>
                        <StatusBadge status={delivery.status} />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500">
                        <Clock className="h-3 w-3" />
                        <span className={elapsedColor(delivery.createdAt, delivery.status)}>{elapsed(delivery.createdAt)} ago</span>
                        <span className="text-zinc-700">·</span>
                        <span className="font-semibold text-amber-400/80">{delivery.totalAed} AED</span>
                        <span className="text-zinc-700">·</span>
                        <ChannelBadge channel={delivery.channel} />
                      </div>
                    </div>
                  </div>

                  <div className="neon-divider mx-4" />

                  {/* Customer + Driver + Items */}
                  <div className="p-4 pt-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <User className="h-3.5 w-3.5 text-zinc-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-zinc-200 truncate">{delivery.customerName || "Customer"}</div>
                        {delivery.customerPhone && (
                          <a href={`tel:${delivery.customerPhone}`} className="text-xs text-blue-400 hover:underline flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" />{delivery.customerPhone}
                          </a>
                        )}
                      </div>
                    </div>

                    {delivery.deliveryAddress && (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-3.5 w-3.5 text-zinc-600 mt-0.5 flex-shrink-0" />
                        <a
                          href={`https://maps.google.com/?q=${encodeURIComponent(delivery.deliveryAddress)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="text-xs text-zinc-400 hover:text-amber-400 flex items-center gap-1 transition-colors leading-snug"
                        >
                          {delivery.deliveryAddress}
                          <ExternalLink className="h-2.5 w-2.5 flex-shrink-0" />
                        </a>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Truck className="h-3.5 w-3.5 text-zinc-600 flex-shrink-0" />
                      <span className={`text-xs ${delivery.staffName ? "text-zinc-300 font-medium" : "text-zinc-600 italic"}`}>
                        {delivery.staffName || "Unassigned"}
                      </span>
                      {delivery.claimedAt && (
                        <span className="text-zinc-700 text-[10px]">· claimed {format(new Date(delivery.claimedAt), "HH:mm")}</span>
                      )}
                    </div>

                    {delivery.items.length > 0 && (
                      <div className="flex items-start gap-2">
                        <Package className="h-3.5 w-3.5 text-zinc-600 mt-0.5 flex-shrink-0" />
                        <span className="text-xs text-zinc-500 leading-relaxed">
                          {delivery.items.map(i => `${i.quantity}× ${i.menuItemName ?? "Item"}`).join(", ")}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Actions — Mission Control can force-advance status */}
                  {isActive && (
                    <>
                      <div className="neon-divider mx-4" />
                      <div className="p-3 flex gap-2">
                        {delivery.status === "ready" && (
                          <div className="flex-1 h-9 flex items-center justify-center text-xs text-emerald-400/70 border border-emerald-500/20 rounded-lg">
                            Awaiting rider claim from Field Portal
                          </div>
                        )}
                        {delivery.status === "assigned" && (
                          <button
                            disabled={actionPending[delivery.id]}
                            onClick={() => handlePickup(delivery.id)}
                            className="flex-1 h-9 text-xs font-bold rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-40"
                          >
                            {actionPending[delivery.id] ? "..." : "✓ Mark Picked Up"}
                          </button>
                        )}
                        {delivery.status === "out_for_delivery" && (
                          <>
                            <button
                              disabled={actionPending[delivery.id]}
                              onClick={() => handleComplete(delivery.id, "delivered")}
                              className="flex-1 h-9 text-xs font-bold rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                            >
                              <Check className="h-3.5 w-3.5" />{actionPending[delivery.id] ? "..." : "Delivered"}
                            </button>
                            <button
                              disabled={actionPending[delivery.id]}
                              onClick={() => handleComplete(delivery.id, "failed")}
                              className="h-9 px-3 text-xs font-bold rounded-lg bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                            >
                              <X className="h-3.5 w-3.5" />Failed
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
