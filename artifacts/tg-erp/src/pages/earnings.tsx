import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChefHat, Bike, DollarSign, TrendingUp, Calendar, Users, Award, Filter } from "lucide-react";
import { format, subDays, startOfMonth } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function getToken() { return localStorage.getItem("tg_erp_token"); }
async function apiFetch(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

interface MyRecord { id: number; orderId: number; amountAed: number; type: string; createdAt: string }
interface MyEarnings {
  userId: number; name: string; role: string; type: string;
  totalAed: number; orderCount: number; avgPerOrder: number; ratePerOrder: number;
  records: MyRecord[];
}

interface AdminRecord extends MyRecord { userId: number; userName: string }
interface StaffBreakdown { userId: number; name: string; role: string; type: string; orderCount: number; totalAed: number }
interface AllCommissions {
  totalCommissions: number; totalChefCommissions: number; totalDeliveryCommissions: number;
  chefCommissionPerOrder: number; deliveryCommissionPerOrder: number;
  staffBreakdown: StaffBreakdown[];
  records: AdminRecord[];
}

const IS_STAFF = (role: string) => role === "kitchen_staff" || role === "delivery_staff";
const IS_ADMIN = (role: string) => role === "super_admin" || role === "branch_manager";

function typeColor(type: string) {
  return type === "chef"
    ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
    : "text-blue-400 border-blue-500/30 bg-blue-500/10";
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant="outline" className={typeColor(type)}>
      {type === "chef"
        ? <><ChefHat className="h-3 w-3 mr-1 inline" />Chef</>
        : <><Bike className="h-3 w-3 mr-1 inline" />Delivery</>}
    </Badge>
  );
}

// ─────────────────────────────────────────────────────
// STAFF VIEW — own earnings only
// ─────────────────────────────────────────────────────
function StaffEarnings({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<MyEarnings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    apiFetch(`/api/finance/commissions/mine?${qs}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground text-sm">Loading earnings...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground text-sm">Could not load earnings data.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-amber-500/15">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              Total Earned <DollarSign className="h-3.5 w-3.5 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-amber-400">{data.totalAed.toLocaleString()} AED</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">all time (filtered)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              Orders Done <Award className="h-3.5 w-3.5 text-green-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-green-400">{data.orderCount}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">completed orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              Avg / Order <TrendingUp className="h-3.5 w-3.5 text-blue-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-blue-400">{data.avgPerOrder.toFixed(1)} AED</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">per completed order</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              Current Rate <ChefHat className="h-3.5 w-3.5 text-zinc-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">{data.ratePerOrder} AED</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">per order (set by admin)</p>
          </CardContent>
        </Card>
      </div>

      {/* History table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Commission History</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; Time</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                    No commissions recorded in this period. Commissions are added automatically when you accept or complete orders.
                  </TableCell>
                </TableRow>
              ) : data.records.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm tabular-nums">
                    {format(new Date(r.createdAt), "MMM d, yyyy")}
                    <span className="ml-2 text-muted-foreground text-xs">{format(new Date(r.createdAt), "HH:mm")}</span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">#{r.orderId}</TableCell>
                  <TableCell><TypeBadge type={r.type} /></TableCell>
                  <TableCell className="text-right font-bold text-amber-400">{r.amountAed.toFixed(2)} AED</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.records.length > 0 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-border/50 text-sm">
              <span className="text-muted-foreground">{data.records.length} entries</span>
              <span className="font-bold text-amber-400">{data.totalAed.toLocaleString()} AED total</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// ADMIN VIEW — all staff, with filters
// ─────────────────────────────────────────────────────
function AdminEarnings({ from, to }: { from: string; to: string }) {
  const [data, setData] = useState<AllCommissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    apiFetch(`/api/finance/commissions?${qs}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const filteredRecords = data?.records.filter(r =>
    selectedUser == null || r.userId === selectedUser
  ) ?? [];

  const selectedBreakdown = selectedUser != null
    ? data?.staffBreakdown.find(s => s.userId === selectedUser)
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground text-sm">Loading earnings data...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground text-sm">Could not load earnings data.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card className="border-amber-500/15">
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              Total Commissions <DollarSign className="h-3.5 w-3.5 text-amber-500" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-amber-400">{data.totalCommissions.toLocaleString()} AED</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">paid to all staff</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              Chef Pool <ChefHat className="h-3.5 w-3.5 text-amber-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-amber-400">{data.totalChefCommissions.toLocaleString()} AED</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{data.chefCommissionPerOrder} AED/order rate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              Delivery Pool <Bike className="h-3.5 w-3.5 text-blue-400" />
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold text-blue-400">{data.totalDeliveryCommissions.toLocaleString()} AED</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{data.deliveryCommissionPerOrder} AED/order rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Staff leaderboard */}
      {data.staffBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-400" /> Staff Leaderboard
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-center">Orders</TableHead>
                  <TableHead className="text-right">Total Earned</TableHead>
                  <TableHead className="text-right">View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.staffBreakdown.map((s, i) => (
                  <TableRow
                    key={s.userId}
                    className={selectedUser === s.userId ? "bg-amber-500/5" : ""}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: i === 0 ? "hsl(38 88% 52% / 0.2)" : "hsl(0 0% 15%)", color: i === 0 ? "hsl(38 88% 60%)" : "hsl(0 0% 50%)" }}>
                          {i + 1}
                        </span>
                        <span className="font-medium text-sm">{s.name}</span>
                      </div>
                    </TableCell>
                    <TableCell><TypeBadge type={s.type} /></TableCell>
                    <TableCell className="text-center tabular-nums">{s.orderCount}</TableCell>
                    <TableCell className="text-right font-bold text-amber-400 tabular-nums">{s.totalAed.toLocaleString()} AED</TableCell>
                    <TableCell className="text-right">
                      <button
                        onClick={() => setSelectedUser(selectedUser === s.userId ? null : s.userId)}
                        className="text-xs px-2 py-1 rounded border transition-colors"
                        style={selectedUser === s.userId
                          ? { borderColor: "hsl(38 88% 52% / 0.5)", color: "hsl(38 88% 52%)", background: "hsl(38 88% 52% / 0.1)" }
                          : { borderColor: "hsl(0 0% 20%)", color: "hsl(0 0% 50%)" }}
                      >
                        {selectedUser === s.userId ? "Clear" : "Filter"}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Commission history table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {selectedBreakdown ? `${selectedBreakdown.name}'s History` : "All Commission Records"}
          </CardTitle>
          {selectedUser != null && (
            <button
              onClick={() => setSelectedUser(null)}
              className="text-xs text-muted-foreground hover:text-zinc-200 transition-colors"
            >
              Clear filter
            </button>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; Time</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Order #</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRecords.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    No commission records found for this period.
                  </TableCell>
                </TableRow>
              ) : filteredRecords.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-sm tabular-nums">
                    {format(new Date(r.createdAt), "MMM d, yyyy")}
                    <span className="ml-2 text-muted-foreground text-xs">{format(new Date(r.createdAt), "HH:mm")}</span>
                  </TableCell>
                  <TableCell className="text-sm">{r.userName}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">#{r.orderId}</TableCell>
                  <TableCell><TypeBadge type={r.type} /></TableCell>
                  <TableCell className="text-right font-bold text-amber-400">{r.amountAed.toFixed(2)} AED</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filteredRecords.length > 0 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-border/50 text-sm">
              <span className="text-muted-foreground">{filteredRecords.length} records</span>
              <span className="font-bold text-amber-400">
                {filteredRecords.reduce((s, r) => s + r.amountAed, 0).toLocaleString()} AED total
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────
export default function Earnings() {
  const { user } = useAuth();
  const today = format(new Date(), "yyyy-MM-dd");
  const monthStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);

  const isStaff = user ? IS_STAFF(user.role) : false;
  const isAdmin = user ? IS_ADMIN(user.role) : false;

  const roleIcon = user?.role === "kitchen_staff"
    ? <ChefHat className="h-5 w-5 text-amber-400" />
    : user?.role === "delivery_staff"
    ? <Bike className="h-5 w-5 text-blue-400" />
    : <Users className="h-5 w-5 text-amber-400" />;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(38 50% 12%)", border: "1px solid hsl(38 88% 52% / 0.2)" }}>
            {roleIcon}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {isStaff ? "My Earnings" : "Staff Earnings"}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {isStaff
                ? `Commission dashboard for ${user?.name ?? ""}`
                : "Commission history and leaderboard for all staff"}
            </p>
          </div>
        </div>

        {/* Date range filter */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
            <Filter className="h-3.5 w-3.5" /> <Calendar className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-xs text-muted-foreground w-7 shrink-0">From</Label>
            <Input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              className="h-8 text-xs w-36 border-zinc-700/60"
            />
          </div>
          <div className="flex items-center gap-1">
            <Label className="text-xs text-muted-foreground w-4 shrink-0">To</Label>
            <Input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="h-8 text-xs w-36 border-zinc-700/60"
            />
          </div>
          <div className="flex gap-1">
            {[
              { label: "Today", fn: () => { setFrom(today); setTo(today); } },
              { label: "Month", fn: () => { setFrom(monthStart); setTo(today); } },
              { label: "7d", fn: () => { setFrom(format(subDays(new Date(), 7), "yyyy-MM-dd")); setTo(today); } },
            ].map(btn => (
              <button
                key={btn.label}
                onClick={btn.fn}
                className="h-8 px-2 text-xs rounded border border-zinc-700/60 text-zinc-400 hover:text-amber-400 hover:border-amber-500/40 transition-colors"
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Role-aware content */}
      {isStaff && <StaffEarnings from={from} to={to} />}
      {isAdmin && <AdminEarnings from={from} to={to} />}
      {!isStaff && !isAdmin && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          Earnings data is not available for your role.
        </div>
      )}
    </div>
  );
}
