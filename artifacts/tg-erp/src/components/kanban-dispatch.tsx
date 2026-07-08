import { useEffect, useState, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/use-socket";
import { useAuth } from "@/lib/auth";
import { Clock, Package, Truck, CheckCircle2, XCircle, GripVertical } from "lucide-react";
import { getApiBase } from "@/lib/api-base";

interface KanbanOrder {
  id: number; orderCode: string; status: string; channel: string;
  customerName: string | null; deliveryAddress: string | null;
  assignedDeliveryName: string | null; assignedDeliveryUserId: number | null;
  relayedByName: string | null; totalAed: number; createdAt: string;
}

const COLUMNS = [
  { key: "ready",           label: "Ready for Pickup", icon: Package,      color: "text-green-400",  border: "border-green-900/40", bg: "bg-green-950/10" },
  { key: "assigned",        label: "Assigned",          icon: Truck,        color: "text-amber-400",  border: "border-amber-900/40", bg: "bg-amber-950/10" },
  { key: "out_for_delivery",label: "Out for Delivery",  icon: Truck,        color: "text-blue-400",   border: "border-blue-900/40",  bg: "bg-blue-950/10" },
  { key: "delivered",       label: "Delivered",         icon: CheckCircle2, color: "text-zinc-400",   border: "border-zinc-800",     bg: "bg-zinc-900/20" },
  { key: "failed",          label: "Failed",            icon: XCircle,      color: "text-red-400",    border: "border-red-900/40",   bg: "bg-red-950/10" },
];

const BASE = getApiBase();
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

function elapsed(createdAt: string) {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function KanbanDispatch({ branchId }: { branchId?: number }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const socket = useSocket({ branchId: branchId ?? user?.branchId ?? undefined });
  const [orders, setOrders] = useState<KanbanOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const dragOrder = useRef<KanbanOrder | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (branchId) params.set("branchId", String(branchId));
      const data: KanbanOrder[] = await apiFetch(`/api/orders?${params}`);
      // Filter to delivery pipeline statuses
      setOrders(data.filter(o => ["ready", "assigned", "out_for_delivery", "delivered", "failed"].includes(o.status)));
    } catch { /* ignore */ }
    setLoading(false);
  }, [branchId]);

  useEffect(() => { load(); const iv = setInterval(load, 12000); return () => clearInterval(iv); }, [load]);

  useEffect(() => {
    socket.on("order:status", (data: { orderId: number; status: string }) => {
      setOrders(prev => prev.map(o => o.id === data.orderId ? { ...o, status: data.status } : o));
    });
    socket.on("order:new", (order: KanbanOrder) => {
      // Don't add to kanban — kanban is post-ready pipeline
    });
    return () => { socket.off("order:status"); };
  }, [socket]);

  const moveCard = async (order: KanbanOrder, newStatus: string) => {
    if (order.status === newStatus) return;
    // Validate allowed transitions
    const allowed: Record<string, string[]> = {
      ready: ["assigned", "failed"],
      assigned: ["out_for_delivery", "failed"],
      out_for_delivery: ["delivered", "failed"],
    };
    if (!allowed[order.status]?.includes(newStatus)) {
      toast({ title: "Invalid transition", description: `Cannot move from ${order.status} to ${newStatus}`, variant: "destructive" });
      return;
    }

    // Optimistic update
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));

    try {
      if (newStatus === "assigned") {
        await apiFetch(`/api/delivery/orders/${order.id}/claim`, "POST", { userId: user?.id });
      } else if (newStatus === "out_for_delivery") {
        await apiFetch(`/api/delivery/orders/${order.id}/pickup`, "POST", { userId: user?.id });
      } else if (newStatus === "delivered") {
        await apiFetch(`/api/delivery/orders/${order.id}/complete`, "POST", { userId: user?.id, outcome: "delivered" });
      } else if (newStatus === "failed") {
        await apiFetch(`/api/delivery/orders/${order.id}/complete`, "POST", { userId: user?.id, outcome: "failed" });
      }
      toast({ title: "Status updated", description: `${order.orderCode} → ${newStatus.replace(/_/g, " ")}` });
    } catch {
      // Rollback
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: order.status } : o));
      toast({ title: "Update failed", description: "Could not update order status", variant: "destructive" });
    }
  };

  const onDragStart = (e: React.DragEvent, order: KanbanOrder) => {
    dragOrder.current = order;
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (e: React.DragEvent, columnKey: string) => {
    e.preventDefault();
    if (dragOrder.current) moveCard(dragOrder.current, columnKey);
    dragOrder.current = null;
  };

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };

  if (loading) return <div className="text-zinc-500 text-sm animate-pulse">Loading dispatch board...</div>;

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-[900px]">
        {COLUMNS.map(col => {
          const Icon = col.icon;
          const colOrders = orders.filter(o => o.status === col.key);
          return (
            <div
              key={col.key}
              className={`flex-1 min-w-[180px] rounded-2xl border ${col.border} ${col.bg} p-3 space-y-3`}
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, col.key)}
            >
              <div className={`flex items-center gap-2 font-bold text-sm ${col.color}`}>
                <Icon className="h-4 w-4" />
                {col.label}
                <Badge className="ml-auto bg-zinc-800 text-zinc-400 border-zinc-700 text-xs">{colOrders.length}</Badge>
              </div>
              <div className="space-y-2 min-h-[60px]">
                {colOrders.map(order => (
                  <div
                    key={order.id}
                    draggable
                    onDragStart={e => onDragStart(e, order)}
                    className="rounded-xl border border-zinc-700/50 bg-zinc-900 p-3 cursor-grab active:cursor-grabbing space-y-1.5 group hover:border-amber-700/50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-mono font-black text-sm text-amber-400">{order.orderCode}</span>
                      <GripVertical className="h-4 w-4 text-zinc-700 group-hover:text-zinc-500 flex-shrink-0" />
                    </div>
                    {order.customerName && <div className="text-xs text-zinc-300 font-semibold truncate">{order.customerName}</div>}
                    {order.deliveryAddress && <div className="text-xs text-zinc-600 truncate">{order.deliveryAddress}</div>}
                    {order.assignedDeliveryName && (
                      <div className="text-xs text-blue-400 flex items-center gap-1">
                        <Truck className="h-3 w-3" />{order.assignedDeliveryName}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-zinc-600 flex items-center gap-1"><Clock className="h-3 w-3" />{elapsed(order.createdAt)}</span>
                      <span className="text-xs font-bold text-zinc-400">{order.totalAed} AED</span>
                    </div>
                  </div>
                ))}
                {colOrders.length === 0 && (
                  <div className="text-xs text-zinc-700 text-center py-4 border border-dashed border-zinc-800 rounded-xl">
                    Drop here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
