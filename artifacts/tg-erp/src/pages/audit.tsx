import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useListBranches } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { FileDown, ShieldCheck, ListChecks, Loader2, Users, TrendingUp, Package } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function getToken() { return localStorage.getItem("tg_erp_token"); }

async function downloadCsv(path: string, filename: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) throw new Error(`${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AuditPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: branches } = useListBranches();
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split("T")[0];
  });
  const [branchId, setBranchId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const branchQuery = branchId ? `&branchId=${branchId}` : "";

  const exportWeeklyRevenue = async () => {
    setBusy("weekly");
    try {
      await downloadCsv(`/api/audit/weekly-revenue?weekStart=${weekStart}${branchQuery}`, `weekly-revenue-${weekStart}.csv`);
      toast({ title: "Export ready", description: "Weekly revenue report downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setBusy(null);
  };

  const exportStaffActivity = async () => {
    setBusy("staff");
    try {
      await downloadCsv(`/api/audit/staff-activity?date=${date}${branchQuery}`, `staff-activity-${date}.csv`);
      toast({ title: "Export ready", description: "Staff activity report downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setBusy(null);
  };

  const exportInventory = async () => {
    setBusy("inventory");
    try {
      await downloadCsv(`/api/audit/inventory-report${branchQuery ? `?${branchQuery.slice(1)}` : ""}`, `inventory-report.csv`);
      toast({ title: "Export ready", description: "Inventory report downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setBusy(null);
  };

  const exportDailyOrders = async () => {
    setBusy("orders");
    try {
      await downloadCsv(`/api/audit/daily-orders?date=${date}${branchQuery}`, `daily-order-audit-${date}.csv`);
      toast({ title: "Export ready", description: "Daily order audit downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setBusy(null);
  };

  const exportOrderHistory = async () => {
    setBusy("history");
    try {
      await downloadCsv(`/api/audit/order-history?date=${date}${branchQuery}`, `order-history-audit-${date}.csv`);
      toast({ title: "Export ready", description: "Order status history downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setBusy(null);
  };

  if (user && !["super_admin", "branch_manager"].includes(user.role)) {
    return <div className="p-8 text-muted-foreground">You don't have access to Audit &amp; Reports.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-amber-500" /> Audit &amp; Reports</h1>
        <p className="text-sm text-muted-foreground">Export daily order and status-change trails for compliance and reconciliation.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Filters</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label>Week Starting</Label>
            <Input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label>Branch</Label>
            <select
              className="h-9 rounded-md border bg-background px-3 text-sm w-56"
              value={branchId}
              onChange={e => setBranchId(e.target.value)}
            >
              <option value="">All Branches</option>
              {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileDown className="h-4 w-4" /> Daily Order Audit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One row per order: channel, customer, total, payment method, and who relayed/accepted/marked-ready/delivered it.
            </p>
            <Button onClick={exportDailyOrders} disabled={busy !== null} className="w-full">
              {busy === "orders" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Download CSV
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><ListChecks className="h-4 w-4" /> Order Status History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Full status-change trail: every transition, who changed it, and when — for full traceability.
            </p>
            <Button onClick={exportOrderHistory} disabled={busy !== null} className="w-full" variant="outline">
              {busy === "history" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Download CSV
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-amber-400" /> Weekly Revenue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Day-by-day revenue breakdown for the selected week: totals, channel splits, and average order value.
            </p>
            <Button onClick={exportWeeklyRevenue} disabled={busy !== null} className="w-full" variant="outline">
              {busy === "weekly" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Download CSV
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4 text-amber-400" /> Staff Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Per-staff breakdown of relayed, prepared, and delivered orders for the selected date, with commission totals.
            </p>
            <Button onClick={exportStaffActivity} disabled={busy !== null} className="w-full" variant="outline">
              {busy === "staff" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Download CSV
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4 text-amber-400" /> Inventory Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Current stock levels vs reorder thresholds — highlights items below reorder point for immediate action.
            </p>
            <Button onClick={exportInventory} disabled={busy !== null} className="w-full" variant="outline">
              {busy === "inventory" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileDown className="h-4 w-4 mr-2" />}
              Download CSV
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
