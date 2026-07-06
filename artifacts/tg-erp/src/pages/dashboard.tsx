import { useState } from "react";
import {
  useGetDashboardSummary,
  useGetLiveOrders,
  useGetDashboardAlerts,
  useGetTopMenuItems,
  useGetBranchStats,
  useListBranches,
  getGetDashboardSummaryQueryKey,
  getGetLiveOrdersQueryKey,
  getGetTopMenuItemsQueryKey,
  getGetBranchStatsQueryKey,
  Order,
  Alert,
  TopMenuItem,
  BranchStat,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AlertCircle, DollarSign, LayoutDashboard, ShoppingBag, Truck, UtensilsCrossed } from "lucide-react";
import { Empty, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { KanbanDispatch } from "@/components/kanban-dispatch";
import { MyTasks } from "@/components/my-tasks";

function statusColor(status: string): string {
  const map: Record<string, string> = {
    pending_acceptance: "bg-amber-500/20 text-amber-500 border-amber-500/30",
    preparing: "bg-orange-500/20 text-orange-500 border-orange-500/30",
    ready: "bg-green-500/20 text-green-500 border-green-500/30",
    assigned: "bg-blue-500/20 text-blue-500 border-blue-500/30",
    out_for_delivery: "bg-blue-400/20 text-blue-400 border-blue-400/30",
    delivered: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
    failed: "bg-red-500/20 text-red-500 border-red-500/30",
  };
  return map[status] ?? "bg-muted text-muted-foreground";
}

function KpiCard({ title, value, icon, loading, sub }: { title: string; value?: string | number; icon: React.ReactNode; loading?: boolean; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? <Skeleton className="h-8 w-20 mt-1" /> : <p className="text-3xl font-black mt-1">{value ?? "—"}</p>}
            {sub && !loading && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="rounded-full p-2 bg-primary/10">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  // Branch selector (super admin only)
  const [selectedBranch, setSelectedBranch] = useState<number | undefined>(user?.branchId ?? undefined);
  const { data: branches } = useListBranches({ query: { enabled: isSuperAdmin, queryKey: ["branches"] } });

  const effectiveBranchId = isSuperAdmin ? (selectedBranch ?? undefined) : (user?.branchId ?? undefined);

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary(
    { branchId: effectiveBranchId },
    { query: { refetchInterval: 15000, queryKey: getGetDashboardSummaryQueryKey({ branchId: effectiveBranchId }) } }
  );
  const { data: liveOrders, isLoading: loadingOrders } = useGetLiveOrders(
    { branchId: effectiveBranchId },
    { query: { refetchInterval: 10000, queryKey: getGetLiveOrdersQueryKey({ branchId: effectiveBranchId }) } }
  );
  const { data: alerts } = useGetDashboardAlerts({ branchId: effectiveBranchId });
  const { data: topItems, isLoading: loadingTopItems } = useGetTopMenuItems(
    { branchId: effectiveBranchId, limit: 5 },
    { query: { queryKey: getGetTopMenuItemsQueryKey({ branchId: effectiveBranchId, limit: 5 }) } }
  );
  const { data: branchStats, isLoading: loadingStats } = useGetBranchStats(
    { query: { enabled: isSuperAdmin, queryKey: getGetBranchStatsQueryKey() } }
  );

  const criticalAlerts = alerts?.filter(a => a.severity === "critical") ?? [];
  const branchLabel = isSuperAdmin && !selectedBranch ? "All Branches" : branches?.find(b => b.id === selectedBranch)?.name ?? "My Branch";

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary">Command Center</h1>
          <p className="text-muted-foreground mt-1">Real-time overview — <span className="text-primary font-semibold">{branchLabel}</span></p>
        </div>
        {/* Branch selector — super admin only */}
        {isSuperAdmin && branches && (
          <Select
            value={selectedBranch ? String(selectedBranch) : "all"}
            onValueChange={v => setSelectedBranch(v === "all" ? undefined : parseInt(v, 10))}
          >
            <SelectTrigger className="w-[220px] border-primary/30">
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Branches (Consolidated)</SelectItem>
              {branches.map(b => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* My Tasks widget */}
      <MyTasks />

      {/* Critical alerts banner */}
      {criticalAlerts.length > 0 && (
        <div className="rounded-xl border border-red-700/50 bg-red-950/20 px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" />
          <div className="text-sm text-red-300 font-semibold">{criticalAlerts.length} critical alert{criticalAlerts.length > 1 ? "s" : ""}: {criticalAlerts.map(a => a.message).join(" · ")}</div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Today's Orders" value={summary?.todayOrders} icon={<ShoppingBag className="h-5 w-5 text-amber-500" />} loading={loadingSummary} />
        <KpiCard title="Revenue (AED)" value={summary?.todayRevenue?.toLocaleString()} icon={<DollarSign className="h-5 w-5 text-green-500" />} loading={loadingSummary} />
        <KpiCard title="Kitchen Pending" value={summary?.pendingKitchen} icon={<UtensilsCrossed className="h-5 w-5 text-orange-500" />} loading={loadingSummary} />
        <KpiCard title="Active Deliveries" value={summary?.activeDeliveries} icon={<Truck className="h-5 w-5 text-blue-500" />} loading={loadingSummary} />
      </div>

      {/* Main tabs: Overview / Dispatch Board */}
      <Tabs defaultValue="overview">
        <TabsList className="bg-zinc-900/60 border border-zinc-800">
          <TabsTrigger value="overview" className="data-[state=active]:bg-amber-500 data-[state=active]:text-black font-semibold">
            <LayoutDashboard className="h-4 w-4 mr-1.5" />Overview
          </TabsTrigger>
          <TabsTrigger value="dispatch" className="data-[state=active]:bg-amber-500 data-[state=active]:text-black font-semibold">
            Dispatch Board
          </TabsTrigger>
          {isSuperAdmin && !selectedBranch && (
            <TabsTrigger value="branches" className="data-[state=active]:bg-amber-500 data-[state=active]:text-black font-semibold">
              Branch Comparison
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Live Orders */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-primary" />Live Orders</CardTitle></CardHeader>
                <CardContent>
                  {loadingOrders ? (
                    <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
                  ) : !liveOrders?.length ? (
                    <Empty><EmptyTitle>No active orders</EmptyTitle><EmptyDescription>New orders will appear here in real time</EmptyDescription></Empty>
                  ) : (
                    <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                      {liveOrders.map((order: Order) => (
                        <div key={order.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card/40 hover:bg-card/80 transition-colors">
                          <div className="flex items-center gap-3">
                            <span className="font-mono font-black text-primary text-sm">{order.orderCode}</span>
                            <span className="text-sm text-muted-foreground">{order.customerName ?? "Customer"}</span>
                            <span className="text-xs text-muted-foreground/60 capitalize">{order.channel?.replace("_", " ")}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{order.totalAed} AED</span>
                            <Badge variant="outline" className={`text-xs ${statusColor(order.status)}`}>
                              {order.status.replace(/_/g, " ")}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Alerts + Top Items */}
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4 text-amber-500" />Alerts</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {!alerts?.length ? (
                    <p className="text-muted-foreground text-sm">All clear</p>
                  ) : alerts.slice(0, 5).map((a: Alert, i) => (
                    <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded-lg ${a.severity === "critical" ? "bg-red-950/30 text-red-300" : a.severity === "warning" ? "bg-amber-950/30 text-amber-300" : "bg-zinc-900 text-zinc-400"}`}>
                      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      {a.message}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-sm">Top Items Today</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {loadingTopItems ? <Skeleton className="h-20 w-full" /> : (topItems ?? []).map((item: TopMenuItem, i) => (
                    <div key={item.menuItemId} className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground"><span className="text-xs text-primary/60 mr-1">#{i + 1}</span>{item.nameEn}</span>
                      <span className="font-bold">{item.totalSold}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="dispatch" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Delivery Dispatch Board
                <span className="text-xs text-muted-foreground font-normal ml-2">Drag cards to update status</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <KanbanDispatch branchId={effectiveBranchId} />
            </CardContent>
          </Card>
        </TabsContent>

        {isSuperAdmin && !selectedBranch && (
          <TabsContent value="branches" className="mt-4">
            <Card>
              <CardHeader><CardTitle>Branch Performance Comparison</CardTitle></CardHeader>
              <CardContent>
                {loadingStats ? <Skeleton className="h-64 w-full" /> : !branchStats?.length ? (
                  <Empty><EmptyTitle>No branch data</EmptyTitle></Empty>
                ) : (
                  <div className="space-y-6">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={branchStats} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                        <XAxis dataKey="branchName" stroke="#71717a" tick={{ fontSize: 12 }} />
                        <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
                        <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: "8px" }} />
                        <Bar dataKey="todayRevenue" name="Revenue (AED)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="todayOrders" name="Orders" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="rounded-xl border border-zinc-800 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="border-b border-zinc-800 bg-zinc-900/60">
                          <tr>
                            {["Branch", "Today Orders", "Revenue (AED)", "Pending Orders", "Active Staff"].map(h => (
                              <th key={h} className="text-left px-4 py-3 font-semibold text-zinc-400 text-xs">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {branchStats.map((b: BranchStat) => (
                            <tr key={b.branchId} className="border-b border-zinc-800/50 hover:bg-zinc-900/40 transition-colors">
                              <td className="px-4 py-3 font-semibold">{b.branchName}</td>
                              <td className="px-4 py-3">{b.todayOrders}</td>
                              <td className="px-4 py-3 font-bold text-amber-400">{b.todayRevenue?.toLocaleString()}</td>
                              <td className="px-4 py-3">{b.pendingOrders ?? "—"}</td>
                              <td className="px-4 py-3">{b.activeStaff}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
