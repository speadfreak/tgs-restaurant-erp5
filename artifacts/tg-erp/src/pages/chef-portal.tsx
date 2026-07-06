import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useSocket } from "@/hooks/use-socket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ChefHat, Clock, LogOut, Wifi, WifiOff, Bell, Eye, EyeOff } from "lucide-react";
import { MyTasks } from "@/components/my-tasks";

interface OrderItem { menuItemName: string | null; quantity: number; unitPrice: number; notes: string | null }
interface KitchenTicket {
  id: number; orderCode: string; status: string; channel: string;
  elapsedMinutes: number; customerName: string | null; deliveryAddress: string | null;
  relayedByName: string | null;
  items: OrderItem[]; createdAt: string;
}
interface MenuItem86 { id: number; nameEn: string; available: boolean }

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function getToken() { return localStorage.getItem("tg_erp_token"); }

async function apiFetch(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

function elapsedColor(mins: number) {
  if (mins >= 20) return "border-red-500 bg-red-950/50 shadow-red-500/30 shadow-lg animate-pulse";
  if (mins >= 10) return "border-orange-500 bg-orange-950/40";
  if (mins >= 5) return "border-yellow-500 bg-yellow-950/30";
  return "border-amber-700/50 bg-zinc-900/80";
}

function channelBadge(channel: string) {
  if (channel === "whatsapp_relay") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">📱 WhatsApp Relay</span>;
  if (channel === "whatsapp_voice") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">🎙️ Voice Queue</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">🌐 Web Order</span>;
}

function playAlert(urgent = false) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const freqs = urgent ? [880, 1100, 880] : [660, 880];
    let t = ctx.currentTime;
    freqs.forEach(freq => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq; osc.type = "sine";
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t); osc.stop(t + 0.25); t += 0.28;
    });
  } catch { /* audio unavailable */ }
}

export default function ChefPortal() {
  const { user, logout, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [fetching, setFetching] = useState(false);
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [elapsed, setElapsed] = useState<Record<number, number>>({});
  const [socketConnected, setSocketConnected] = useState(false);
  const [show86Panel, setShow86Panel] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem86[]>([]);
  const [toggling86, setToggling86] = useState<Record<number, boolean>>({});
  const prevCountRef = useRef(0);
  const socket = useSocket({ branchId: user?.branchId ?? undefined, userId: user?.id });

  const fetchQueue = useCallback(async () => {
    setFetching(true);
    try {
      const data: KitchenTicket[] = await apiFetch(`/api/kitchen/queue${user?.branchId ? `?branchId=${user.branchId}` : ""}`);
      setTickets(data);
      if (data.length > prevCountRef.current) playAlert(false);
      prevCountRef.current = data.length;
    } catch { /* ignore */ }
    setFetching(false);
  }, [user?.branchId]);

  const fetch86Menu = useCallback(async () => {
    try {
      const items: MenuItem86[] = await apiFetch(`/api/menu/items${user?.branchId ? `?branchId=${user.branchId}` : ""}`);
      setMenuItems(items);
    } catch { /* ignore */ }
  }, [user?.branchId]);

  useEffect(() => {
    if (user && user.role !== "kitchen_staff" && user.role !== "super_admin" && user.role !== "branch_manager") {
      setLocation("/dashboard");
    }
  }, [user, setLocation]);

  useEffect(() => {
    fetchQueue();
    const iv = setInterval(fetchQueue, 8000);
    return () => clearInterval(iv);
  }, [fetchQueue]);

  // Live elapsed timers
  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed(prev => {
        const next: Record<number, number> = {};
        tickets.forEach(t => {
          next[t.id] = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 60000);
        });
        return next;
      });
    }, 10000);
    return () => clearInterval(iv);
  }, [tickets]);

  // Socket.IO real-time
  useEffect(() => {
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("order:new", (order: KitchenTicket) => {
      setTickets(prev => {
        if (prev.some(t => t.id === order.id)) return prev;
        playAlert(false);
        toast({ title: "New Order", description: `${order.orderCode} — ${order.customerName ?? "Customer"}` });
        return [order, ...prev];
      });
      prevCountRef.current += 1;
    });
    socket.on("order:status", ({ orderId, status }: { orderId: number; status: string }) => {
      setTickets(prev => prev.map(t => t.id === orderId ? { ...t, status } : t)
        .filter(t => !["delivered", "failed", "assigned", "out_for_delivery"].includes(t.status)));
    });
    return () => { socket.off("order:new"); socket.off("order:status"); };
  }, [socket, toast]);

  const accept = async (id: number) => {
    setPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/kitchen/orders/${id}/start`, "PATCH", {});
      setTickets(prev => prev.map(t => t.id === id ? { ...t, status: "preparing" } : t));
      toast({ title: "Order accepted", description: "Now in preparing queue" });
    } catch { toast({ title: "Error", description: "Could not accept order", variant: "destructive" }); }
    setPending(p => ({ ...p, [id]: false }));
  };

  const markReady = async (id: number) => {
    setPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/kitchen/orders/${id}/ready`, "PATCH", {});
      setTickets(prev => prev.filter(t => t.id !== id));
      toast({ title: "Order ready", description: "Delivery team notified" });
    } catch { toast({ title: "Error", description: "Could not mark ready", variant: "destructive" }); }
    setPending(p => ({ ...p, [id]: false }));
  };

  const toggle86 = async (item: MenuItem86) => {
    setToggling86(p => ({ ...p, [item.id]: true }));
    try {
      await apiFetch(`/api/menu/items/${item.id}`, "PATCH", { available: !item.available });
      setMenuItems(prev => prev.map(i => i.id === item.id ? { ...i, available: !i.available } : i));
      toast({ title: item.available ? `86'd: ${item.nameEn}` : `Restored: ${item.nameEn}`, description: item.available ? "Item marked unavailable" : "Item available again" });
    } catch { toast({ title: "Error", description: "Could not update item", variant: "destructive" }); }
    setToggling86(p => ({ ...p, [item.id]: false }));
  };

  const incoming = tickets.filter(t => t.status === "pending_acceptance");
  const preparing = tickets.filter(t => t.status === "preparing");

  if (isLoading) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center"><div className="text-amber-500 animate-pulse text-xl font-bold">Loading...</div></div>;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-amber-900/30 bg-zinc-950/95 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-amber-500/20 flex items-center justify-center border border-amber-500/40">
            <ChefHat className="h-5 w-5 text-amber-500" />
          </div>
          <div>
            <div className="font-black text-lg text-amber-400 leading-none">Chef Portal</div>
            <div className="text-xs text-zinc-500">{user?.name} · <span className={tickets.length > 0 ? "text-amber-400 font-bold" : ""}>{tickets.length} active order{tickets.length !== 1 ? "s" : ""}</span></div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShow86Panel(v => !v); if (!show86Panel) fetch86Menu(); }}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-bold transition-colors ${show86Panel ? "bg-red-500/20 border-red-500/50 text-red-400" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50"}`}
          >
            <EyeOff className="h-3.5 w-3.5" />86 Menu
          </button>
          <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${socketConnected ? "border-green-700 text-green-400 bg-green-950/40" : "border-zinc-700 text-zinc-500"}`}>
            {socketConnected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {socketConnected ? "Live" : "Offline"}
          </div>
          <button onClick={logout} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* 86 Panel */}
      {show86Panel && (
        <div className="border-b border-red-900/30 bg-red-950/20 px-4 py-4">
          <div className="max-w-4xl mx-auto">
            <h3 className="text-red-400 font-bold mb-3 flex items-center gap-2"><Eye className="h-4 w-4" /> 86 / Item Availability</h3>
            {menuItems.length === 0 ? (
              <div className="text-zinc-500 text-sm">Loading menu...</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {menuItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => toggle86(item)}
                    disabled={toggling86[item.id]}
                    className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${item.available ? "border-green-700 bg-green-950/30 text-green-400 hover:bg-red-950/30 hover:border-red-700 hover:text-red-400" : "border-red-700 bg-red-950/30 text-red-400 hover:bg-green-950/30 hover:border-green-700 hover:text-green-400"}`}
                  >
                    {item.available ? "✓" : "86"} {item.nameEn}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 p-4 space-y-8 max-w-6xl mx-auto w-full">
        {/* My Tasks widget */}
        <MyTasks />

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-amber-900/30 bg-zinc-900/60 px-4 py-3 text-center">
            <div className="text-2xl font-black text-amber-400">{incoming.length}</div>
            <div className="text-xs text-zinc-500 font-medium">Incoming</div>
          </div>
          <div className="rounded-xl border border-orange-900/30 bg-zinc-900/60 px-4 py-3 text-center">
            <div className="text-2xl font-black text-orange-400">{preparing.length}</div>
            <div className="text-xs text-zinc-500 font-medium">Preparing</div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-center">
            <div className="text-2xl font-black text-zinc-300">{tickets.length}</div>
            <div className="text-xs text-zinc-500 font-medium">Total Active</div>
          </div>
        </div>

        {/* Incoming queue */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-black text-amber-400">Incoming</h2>
            {incoming.length > 0 && (
              <span className="h-6 w-6 rounded-full bg-amber-500 text-black text-xs font-black flex items-center justify-center animate-bounce">{incoming.length}</span>
            )}
          </div>
          {incoming.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-600">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p>No new orders — you'll hear an alert when one arrives</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {incoming.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map(ticket => {
                const mins = elapsed[ticket.id] ?? ticket.elapsedMinutes;
                return (
                  <div key={ticket.id} className={`rounded-2xl border-2 p-5 space-y-4 transition-all ${elapsedColor(mins)}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-mono font-black text-3xl text-amber-400 leading-none">{ticket.orderCode}</div>
                        {ticket.customerName && <div className="text-sm font-semibold mt-1 text-zinc-200">{ticket.customerName}</div>}
                        {ticket.deliveryAddress && <div className="text-xs text-zinc-500 mt-0.5 truncate max-w-[160px]">{ticket.deliveryAddress}</div>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {channelBadge(ticket.channel)}
                        <div className="flex items-center gap-1 text-xs text-zinc-500"><Clock className="h-3 w-3" />{mins}m</div>
                      </div>
                    </div>
                    <ul className="space-y-1.5 border-t border-zinc-800 pt-3">
                      {ticket.items.map((item, i) => (
                        <li key={i} className="flex justify-between text-sm">
                          <span className="text-zinc-200">{item.menuItemName}</span>
                          <span className="font-black text-amber-400">×{item.quantity}</span>
                        </li>
                      ))}
                    </ul>
                    {ticket.relayedByName && (
                      <div className="text-xs text-zinc-500 bg-zinc-800/50 rounded-lg px-3 py-1.5">
                        Relayed by <span className="font-semibold text-zinc-300">{ticket.relayedByName}</span>
                      </div>
                    )}
                    <Button
                      className="w-full h-14 text-lg font-black bg-amber-500 hover:bg-amber-400 text-black rounded-xl"
                      disabled={pending[ticket.id]}
                      onClick={() => accept(ticket.id)}
                    >
                      {pending[ticket.id] ? "Accepting..." : "Accept Order"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Preparing queue */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-black text-orange-400">Preparing</h2>
            <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">{preparing.length}</Badge>
          </div>
          {preparing.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-600">Nothing being prepared</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {preparing.map(ticket => {
                const mins = elapsed[ticket.id] ?? ticket.elapsedMinutes;
                return (
                  <div key={ticket.id} className={`rounded-2xl border-2 p-5 space-y-4 transition-all ${elapsedColor(mins)}`}>
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="font-mono font-black text-3xl text-orange-400 leading-none">{ticket.orderCode}</div>
                        {ticket.customerName && <div className="text-sm font-semibold mt-1 text-zinc-200">{ticket.customerName}</div>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {channelBadge(ticket.channel)}
                        <div className={`flex items-center gap-1 text-xs ${mins >= 10 ? "text-orange-400 font-bold" : "text-zinc-500"}`}>
                          <Clock className="h-3 w-3" />{mins}m
                        </div>
                      </div>
                    </div>
                    <ul className="space-y-1.5 border-t border-zinc-800 pt-3">
                      {ticket.items.map((item, i) => (
                        <li key={i} className="flex justify-between text-sm">
                          <span className="text-zinc-200">{item.menuItemName}</span>
                          <span className="font-black text-orange-400">×{item.quantity}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full h-14 text-lg font-black bg-green-500 hover:bg-green-400 text-black rounded-xl"
                      disabled={pending[ticket.id]}
                      onClick={() => markReady(ticket.id)}
                    >
                      {pending[ticket.id] ? "Marking..." : "Mark Ready"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
