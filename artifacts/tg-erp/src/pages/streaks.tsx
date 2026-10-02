import { useCallback, useEffect, useState } from "react";
import { Trophy, Plus, RefreshCw, X, Users, Flame, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { getApiBase } from "@/lib/api-base";
import { formatStreakCountdown, formatStreakDateTime } from "@/lib/streak-time";

const BASE = getApiBase();
const token = () => localStorage.getItem("tg_erp_token") ?? "";

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? null : response.json();
}

type Prize = {
  id: number;
  name: string;
  description: string | null;
  prizeType: string;
  discountPercent: number | null;
  freeItemName: string | null;
  customDescription: string | null;
  minOrdersRequired: number;
  minDaysRequired?: number;
  cycleLengthDays: number;
  streakMode: string;
  isActive: boolean;
  branchId: number | null;
};

type Streak = {
  id: number;
  customerName: string | null;
  customerPhone: string;
  streakCode: string;
  ordersCompleted: number;
  ordersRemaining: number;
  minOrdersRequired: number;
  activeDays: number;
  cycleLengthDays: number;
  streakMode: string;
  status: string;
  displayStatus: string;
  cycleStartDate: string;
  cycleEndDate: string;
  cycleStartAt: string;
  cycleEndAt: string;
  daysLeft: number;
  prize: { name: string } | null;
};

const emptyForm = {
  name: "",
  description: "",
  prizeType: "custom",
  customDescription: "",
  minOrdersRequired: "6",
  cycleLengthDays: "7",
};

function Badge({ children, color = "amber" }: { children: React.ReactNode; color?: string }) {
  return <span className={`inline-flex rounded-full border border-${color}-500/30 bg-${color}-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-${color}-300`}>{children}</span>;
}

export default function Streaks() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [active, setActive] = useState<Streak[]>([]);
  const [allStreaks, setAllStreaks] = useState<Streak[]>([]);
  const [winners, setWinners] = useState<Streak[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [totals, setTotals] = useState({ active: 0, onTrack: 0, endingToday: 0, winnersThisWeek: 0 });
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editingPrizeId, setEditingPrizeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboard, prizeRows, allRows] = await Promise.all([
        api("/api/streaks/dashboard"),
        api("/api/streaks/prizes"),
        api("/api/streaks"),
      ]);
      setActive(dashboard.active ?? []);
      setAllStreaks(allRows ?? []);
      setWinners(dashboard.recentWinners ?? []);
      setTotals(dashboard.totals);
      setPrizes(prizeRows ?? []);
    } catch (error) {
      toast({ title: "Could not load loyalty dashboard", description: String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const closeForm = () => {
    setForm(emptyForm);
    setEditingPrizeId(null);
    setShowForm(false);
  };

  const savePrize = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      minOrdersRequired: Number(form.minOrdersRequired),
      cycleLengthDays: Number(form.cycleLengthDays),
      streakMode: "window",
    };
    const isEditing = editingPrizeId !== null;
    try {
      await api(
        isEditing ? `/api/streaks/prizes/${editingPrizeId}` : "/api/streaks/prizes",
        isEditing ? "PATCH" : "POST",
        payload,
      );
      closeForm();
      await load();
      toast({
        title: isEditing ? "Challenge updated" : "Challenge created",
        description: "New challenges will use these settings. Existing challenges keep their original target and time window.",
      });
    } catch (error) {
      toast({ title: "Could not save challenge", description: String(error), variant: "destructive" });
    }
  };

  const editPrize = (prize: Prize) => {
    setEditingPrizeId(prize.id);
    setForm({
      name: prize.name,
      description: prize.description ?? "",
      prizeType: prize.prizeType,
      customDescription: prize.customDescription ?? "",
      minOrdersRequired: String(prize.minOrdersRequired ?? prize.minDaysRequired ?? 6),
      cycleLengthDays: String(prize.cycleLengthDays),
    });
    setShowForm(true);
  };

  const togglePrize = async (prize: Prize) => {
    try {
      await api(`/api/streaks/prizes/${prize.id}`, "PATCH", { isActive: !prize.isActive });
      await load();
    } catch (error) {
      toast({ title: "Could not update challenge", description: String(error), variant: "destructive" });
    }
  };

  const deletePrize = async (prize: Prize) => {
    if (!window.confirm(`Delete "${prize.name}"? Existing challenges keep their recorded prize.`)) return;
    try {
      await api(`/api/streaks/prizes/${prize.id}`, "DELETE");
      await load();
    } catch (error) {
      toast({ title: "Could not delete challenge", description: String(error), variant: "destructive" });
    }
  };

  const resetLoyaltySystem = async () => {
    if (resetConfirmation !== "RESET") return;
    setResetting(true);
    try {
      const result = await api("/api/streaks/reset", "POST", { confirmation: resetConfirmation });
      setShowResetDialog(false);
      setResetConfirmation("");
      await load();
      toast({
        title: "Loyalty system reset",
        description: `${result.deletedChallenges} challenge records and ${result.deletedOrderProgress} order-progress entries removed. Prize catalogue and ERP records were kept.`,
      });
    } catch (error) {
      toast({ title: "Could not reset loyalty system", description: String(error), variant: "destructive" });
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen space-y-6 p-4 md:p-6" style={{ background: "hsl(0 0% 4%)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Flame className="h-5 w-5 text-orange-400" /><h1 className="cinema-title text-2xl text-amber-400">Order Challenge Loyalty</h1></div>
          <p className="mt-1 text-sm text-zinc-500">Track delivered orders inside each customer&apos;s configured time window.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {user?.role === "super_admin" && (
            <Button
              data-testid="button-reset-loyalty"
              variant="outline"
              className="border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200"
              onClick={() => { setResetConfirmation(""); setShowResetDialog(true); }}
            >
              <RotateCcw className="mr-2 h-4 w-4" />Reset loyalty system
            </Button>
          )}
          <Button variant="outline" className="border-zinc-700" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["Active challenges", totals.active, Users, "amber"],
          ["On track", totals.onTrack, Flame, "emerald"],
          ["Ending today", totals.endingToday, RefreshCw, "red"],
          ["Winners this week", totals.winnersThisWeek, Trophy, "violet"],
        ] as const).map(([label, value, Icon, color]) => (
          <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
            <div className={`mb-3 flex items-center gap-2 text-${color}-400`}><Icon className="h-4 w-4" /><span className="text-xs font-bold uppercase tracking-wider">{label}</span></div>
            <div className="text-3xl font-black text-white">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center justify-between border-b border-zinc-800 p-4">
            <div><h2 className="font-bold text-white">Active customer challenges</h2><p className="text-xs text-zinc-500">Each challenge starts with the customer&apos;s first delivered order.</p></div>
            <Badge color="amber">{active.length} tracked</Badge>
          </div>
          <div className="divide-y divide-zinc-900">
            {loading ? <div className="p-6 text-sm text-zinc-500">Loading...</div> : active.length === 0 ? <div className="p-6 text-sm text-zinc-500">No active challenges yet.</div> : active.map(streak => (
              <div key={streak.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-semibold text-zinc-100">{streak.customerName || "Customer"} <span className="ml-2 text-xs text-zinc-600">{streak.customerPhone}</span></div>
                  <div className="mt-1 text-xs text-zinc-500">Code {streak.streakCode} · Started {formatStreakDateTime(streak.cycleStartAt)} · Expires {formatStreakDateTime(streak.cycleEndAt)} (Dubai time)</div>
                </div>
                <div className="text-right"><div className="font-black text-amber-400">{streak.ordersCompleted}/{streak.minOrdersRequired} orders</div><div className="font-mono text-[11px] text-zinc-400">{formatStreakCountdown(streak.cycleEndAt, now)} left</div><Badge color={streak.displayStatus === "at_risk" ? "red" : "emerald"}>{streak.displayStatus.replace("_", " ")}</Badge></div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center justify-between border-b border-zinc-800 p-4">
            <div><h2 className="font-bold text-white">Challenge and prize catalogue</h2><p className="text-xs text-zinc-500">Set exactly how many delivered orders and days are needed to win.</p></div>
            <Button size="sm" onClick={() => { setForm(emptyForm); setEditingPrizeId(null); setShowForm(value => !value); }}><Plus className="mr-1 h-4 w-4" />Add</Button>
          </div>
          {showForm && (
            <form onSubmit={savePrize} className="space-y-3 border-b border-zinc-800 p-4">
              <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Free meal or 20% off" /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Shown to admins and customers" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Orders to win</Label><Input required type="number" min="1" max="100" value={form.minOrdersRequired} onChange={e => setForm({ ...form, minOrdersRequired: e.target.value })} /></div>
                <div><Label>Days in cycle</Label><Input required type="number" min="1" max="90" value={form.cycleLengthDays} onChange={e => setForm({ ...form, cycleLengthDays: e.target.value })} /></div>
              </div>
              <p className="text-xs text-zinc-500">Example: 6 orders in 7 days. Orders are counted even when a customer places multiple orders on the same day.</p>
              <div className="flex gap-2"><Button type="submit">{editingPrizeId === null ? "Save challenge" : "Save changes"}</Button><Button type="button" variant="outline" onClick={closeForm}>Cancel</Button></div>
            </form>
          )}
          <div className="divide-y divide-zinc-900">
            {prizes.map(prize => <div key={prize.id} className="flex items-center justify-between gap-3 p-4">
              <div><div className="flex items-center gap-2 font-semibold text-zinc-100">{prize.name} {prize.isActive ? <Badge color="emerald">active</Badge> : <Badge color="zinc">paused</Badge>}</div><div className="mt-1 text-xs text-zinc-500">{prize.minOrdersRequired ?? prize.minDaysRequired} orders in {prize.cycleLengthDays} days</div></div>
              <div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => editPrize(prize)} aria-label={`Edit ${prize.name}`}><Pencil className="h-4 w-4" /></Button><Button size="sm" variant="outline" onClick={() => togglePrize(prize)}>{prize.isActive ? "Pause" : "Activate"}</Button><Button size="sm" variant="ghost" className="text-red-400" onClick={() => deletePrize(prize)} aria-label={`Delete ${prize.name}`}><X className="h-4 w-4" /></Button></div>
            </div>)}
            {prizes.length === 0 && <div className="p-5 text-sm text-zinc-500">No challenges configured. The default 6-order, 7-day challenge will still track progress.</div>}
          </div>
          <p className="border-t border-zinc-800 px-4 py-3 text-xs text-zinc-500">
            Each customer challenge keeps the target and time window it started with. Editing the catalogue affects new challenges; use Reset loyalty system to clear all challenge history and start everyone with the active settings.
          </p>
        </section>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 p-4"><h2 className="font-bold text-white">Recent winners</h2><p className="text-xs text-zinc-500">Winner history is retained for audit and customer support.</p></div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {winners.length === 0 ? <div className="text-sm text-zinc-500">No winners recorded yet.</div> : winners.map(winner => <div key={winner.id} className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3"><div className="flex items-center gap-2 font-semibold text-violet-200"><Trophy className="h-4 w-4" />{winner.customerName || winner.customerPhone}</div><div className="mt-2 text-xs text-zinc-400">{winner.streakCode} · {winner.ordersCompleted} orders completed · {winner.prize?.name ?? "Prize recorded"}</div></div>)}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 p-4"><h2 className="font-bold text-white">All customer challenges</h2><p className="text-xs text-zinc-500">Active, winner, and reset cycles for customer support and audit.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500"><tr><th className="p-3">Customer</th><th className="p-3">Phone</th><th className="p-3">Code</th><th className="p-3">Orders</th><th className="p-3">Cycle</th><th className="p-3">Status</th><th className="p-3">Prize</th></tr></thead>
            <tbody className="divide-y divide-zinc-900">
              {allStreaks.map(streak => <tr key={streak.id} className="text-zinc-300"><td className="p-3 font-semibold text-zinc-100">{streak.customerName || "Customer"}</td><td className="p-3 text-xs">{streak.customerPhone}</td><td className="p-3 font-mono text-xs text-amber-400">{streak.streakCode}</td><td className="p-3">{streak.ordersCompleted}/{streak.minOrdersRequired}</td><td className="p-3 text-xs text-zinc-500"><div>Start {formatStreakDateTime(streak.cycleStartAt)}</div><div>Expires {formatStreakDateTime(streak.cycleEndAt)}</div>{streak.status === "active" && <div className="font-mono text-zinc-300">{formatStreakCountdown(streak.cycleEndAt, now)} left</div>}</td><td className="p-3"><Badge color={streak.status === "won" ? "violet" : streak.status === "lost" ? "zinc" : streak.displayStatus === "at_risk" ? "red" : "emerald"}>{streak.status === "active" ? streak.displayStatus.replace("_", " ") : streak.status}</Badge></td><td className="p-3 text-xs">{streak.prize?.name ?? "Default"}</td></tr>)}
              {allStreaks.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-sm text-zinc-500">No challenge records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showResetDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-loyalty-title"
            aria-describedby="reset-loyalty-description"
            className="w-full max-w-lg rounded-xl border border-red-500/30 bg-zinc-950 p-5 shadow-2xl shadow-black/50"
          >
            <h2 id="reset-loyalty-title" className="text-lg font-bold text-white">Reset the loyalty system?</h2>
            <p id="reset-loyalty-description" className="mt-3 text-sm leading-6 text-zinc-300">
              This permanently deletes every active and historical challenge, recorded delivery progress, and stored customer loyalty code. It keeps the prize catalogue, customer profiles, orders, and all other ERP records.
            </p>
            <Label htmlFor="reset-loyalty-confirmation" className="mt-4 block text-xs text-zinc-400">
              Type RESET to confirm
            </Label>
            <Input
              id="reset-loyalty-confirmation"
              data-testid="input-reset-loyalty-confirmation"
              autoComplete="off"
              value={resetConfirmation}
              onChange={event => setResetConfirmation(event.target.value)}
              className="mt-2 border-zinc-700 bg-zinc-900"
              placeholder="RESET"
            />
            <div className="mt-5 flex justify-end gap-2">
              <Button
                data-testid="button-cancel-reset-loyalty"
                type="button"
                variant="outline"
                disabled={resetting}
                onClick={() => { setShowResetDialog(false); setResetConfirmation(""); }}
              >
                Cancel
              </Button>
              <Button
                data-testid="button-confirm-reset-loyalty"
                type="button"
                variant="destructive"
                disabled={resetting || resetConfirmation !== "RESET"}
                onClick={resetLoyaltySystem}
              >
                {resetting ? "Resetting..." : "Reset all loyalty data"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}