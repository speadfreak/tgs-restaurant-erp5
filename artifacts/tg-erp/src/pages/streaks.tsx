import { useCallback, useEffect, useState } from "react";
import { Trophy, Plus, RefreshCw, X, CheckCircle2, Users, Flame, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/api-base";

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
  id: number; name: string; description: string | null; prizeType: string;
  discountPercent: number | null; freeItemName: string | null; customDescription: string | null;
  minDaysRequired: number; cycleLengthDays: number; streakMode: string; isActive: boolean; branchId: number | null;
};
type Streak = {
  id: number; customerName: string | null; customerPhone: string; streakCode: string;
  activeDays: number; activeDayDates: string[]; cycleLengthDays: number; minDaysRequired: number;
  streakMode: string; status: string; displayStatus: string; cycleEndDate: string;
  prize: { name: string } | null;
};

const emptyForm = {
  name: "", description: "", prizeType: "custom", customDescription: "",
  minDaysRequired: "4", cycleLengthDays: "7", streakMode: "window",
};

function Badge({ children, color = "amber" }: { children: React.ReactNode; color?: string }) {
  return <span className={`inline-flex rounded-full border border-${color}-500/30 bg-${color}-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-${color}-300`}>{children}</span>;
}

export default function Streaks() {
  const { toast } = useToast();
  const [active, setActive] = useState<Streak[]>([]);
  const [allStreaks, setAllStreaks] = useState<Streak[]>([]);
  const [winners, setWinners] = useState<Streak[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [totals, setTotals] = useState({ active: 0, onTrack: 0, endingToday: 0, winnersThisWeek: 0 });
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboard, prizeRows, allRows] = await Promise.all([api("/api/streaks/dashboard"), api("/api/streaks/prizes"), api("/api/streaks")]);
      setActive(dashboard.active ?? []);
      setAllStreaks(allRows ?? []);
      setWinners(dashboard.recentWinners ?? []);
      setTotals(dashboard.totals);
      setPrizes(prizeRows ?? []);
    } catch (error) {
      toast({ title: "Could not load streak dashboard", description: String(error), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const createPrize = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/streaks/prizes", "POST", {
        ...form,
        minDaysRequired: Number(form.minDaysRequired),
        cycleLengthDays: Number(form.cycleLengthDays),
      });
      setForm(emptyForm);
      setShowForm(false);
      await load();
      toast({ title: "Prize created", description: "New loyalty cycles will use this prize when active." });
    } catch (error) {
      toast({ title: "Could not create prize", description: String(error), variant: "destructive" });
    }
  };

  const togglePrize = async (prize: Prize) => {
    try {
      await api(`/api/streaks/prizes/${prize.id}`, "PATCH", { isActive: !prize.isActive });
      await load();
    } catch (error) {
      toast({ title: "Could not update prize", description: String(error), variant: "destructive" });
    }
  };

  const deletePrize = async (prize: Prize) => {
    if (!window.confirm(`Delete "${prize.name}"? Existing streaks keep their recorded prize.`)) return;
    try {
      await api(`/api/streaks/prizes/${prize.id}`, "DELETE");
      await load();
    } catch (error) {
      toast({ title: "Could not delete prize", description: String(error), variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen space-y-6 p-4 md:p-6" style={{ background: "hsl(0 0% 4%)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Flame className="h-5 w-5 text-orange-400" /><h1 className="cinema-title text-2xl text-amber-400">Streak Loyalty</h1></div>
          <p className="mt-1 text-sm text-zinc-500">Track UAE-calendar delivery days, prizes, winners, and at-risk customers.</p>
        </div>
        <Button variant="outline" className="border-zinc-700" onClick={load}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["Active streaks", totals.active, Users, "amber"],
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
            <div><h2 className="font-bold text-white">Active customer streaks</h2><p className="text-xs text-zinc-500">Window and consecutive progress updates after delivery.</p></div>
            <Badge color="amber">{active.length} tracked</Badge>
          </div>
          <div className="divide-y divide-zinc-900">
            {loading ? <div className="p-6 text-sm text-zinc-500">Loading...</div> : active.length === 0 ? <div className="p-6 text-sm text-zinc-500">No active streaks yet.</div> : active.map(streak => (
              <div key={streak.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-semibold text-zinc-100">{streak.customerName || "Customer"} <span className="ml-2 text-xs text-zinc-600">{streak.customerPhone}</span></div>
                  <div className="mt-1 text-xs text-zinc-500">Code {streak.streakCode} · Ends {streak.cycleEndDate} · {streak.streakMode}</div>
                </div>
                <div className="text-right"><div className="font-black text-amber-400">{streak.activeDays}/{streak.minDaysRequired} days</div><Badge color={streak.displayStatus === "at_risk" ? "red" : "emerald"}>{streak.displayStatus.replace("_", " ")}</Badge></div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
          <div className="flex items-center justify-between border-b border-zinc-800 p-4"><div><h2 className="font-bold text-white">Prize catalogue</h2><p className="text-xs text-zinc-500">Choose 5, 7, or 10-day cycles with window or consecutive rules.</p></div><Button size="sm" onClick={() => setShowForm(value => !value)}><Plus className="mr-1 h-4 w-4" />Add</Button></div>
          {showForm && (
            <form onSubmit={createPrize} className="space-y-3 border-b border-zinc-800 p-4">
              <div><Label>Name</Label><Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Free meal or 20% off" /></div>
              <div><Label>Description</Label><Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Shown to admins and customers" /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>Cycle</Label><select className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm" value={form.cycleLengthDays} onChange={e => setForm({ ...form, cycleLengthDays: e.target.value })}><option value="5">5 days</option><option value="7">7 days</option><option value="10">10 days</option></select></div>
                <div><Label>Win at</Label><Input type="number" min="2" value={form.minDaysRequired} onChange={e => setForm({ ...form, minDaysRequired: e.target.value })} /></div>
                <div><Label>Mode</Label><select className="h-10 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 text-sm" value={form.streakMode} onChange={e => setForm({ ...form, streakMode: e.target.value })}><option value="window">Window</option><option value="consecutive">Consecutive</option></select></div>
              </div>
              <div className="flex gap-2"><Button type="submit">Save prize</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button></div>
            </form>
          )}
          <div className="divide-y divide-zinc-900">
            {prizes.map(prize => <div key={prize.id} className="flex items-center justify-between gap-3 p-4"><div><div className="flex items-center gap-2 font-semibold text-zinc-100">{prize.name} {prize.isActive ? <Badge color="emerald">active</Badge> : <Badge color="zinc">paused</Badge>}</div><div className="mt-1 text-xs text-zinc-500">{prize.cycleLengthDays} days · win at {prize.minDaysRequired} · {prize.streakMode}</div></div><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => togglePrize(prize)}>{prize.isActive ? "Pause" : "Activate"}</Button><Button size="sm" variant="ghost" className="text-red-400" onClick={() => deletePrize(prize)}><X className="h-4 w-4" /></Button></div></div>)}
            {prizes.length === 0 && <div className="p-5 text-sm text-zinc-500">No prizes configured. The default cycle will still track progress.</div>}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 p-4"><h2 className="font-bold text-white">Recent winners</h2><p className="text-xs text-zinc-500">Winner history is retained for audit and customer support.</p></div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {winners.length === 0 ? <div className="text-sm text-zinc-500">No winners recorded yet.</div> : winners.map(winner => <div key={winner.id} className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3"><div className="flex items-center gap-2 font-semibold text-violet-200"><Trophy className="h-4 w-4" />{winner.customerName || winner.customerPhone}</div><div className="mt-2 text-xs text-zinc-400">{winner.streakCode} · {winner.activeDays} active days · {winner.prize?.name ?? "Prize recorded"}</div></div>)}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/70">
        <div className="border-b border-zinc-800 p-4"><h2 className="font-bold text-white">All customer streaks</h2><p className="text-xs text-zinc-500">Active, winner, and reset cycles for customer support and audit.</p></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-500"><tr><th className="p-3">Customer</th><th className="p-3">Phone</th><th className="p-3">Code</th><th className="p-3">Progress</th><th className="p-3">Cycle</th><th className="p-3">Status</th><th className="p-3">Prize</th></tr></thead>
            <tbody className="divide-y divide-zinc-900">
              {allStreaks.map(streak => <tr key={streak.id} className="text-zinc-300"><td className="p-3 font-semibold text-zinc-100">{streak.customerName || "Customer"}</td><td className="p-3 text-xs">{streak.customerPhone}</td><td className="p-3 font-mono text-xs text-amber-400">{streak.streakCode}</td><td className="p-3">{streak.activeDays}/{streak.minDaysRequired}</td><td className="p-3 text-xs text-zinc-500">{streak.cycleEndDate}</td><td className="p-3"><Badge color={streak.status === "won" ? "violet" : streak.status === "lost" ? "zinc" : streak.displayStatus === "at_risk" ? "red" : "emerald"}>{streak.status === "active" ? streak.displayStatus.replace("_", " ") : streak.status}</Badge></td><td className="p-3 text-xs">{streak.prize?.name ?? "Default"}</td></tr>)}
              {allStreaks.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-sm text-zinc-500">No streak records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}