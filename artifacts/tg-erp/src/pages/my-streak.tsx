import { useState } from "react";
import { Flame, Search, Trophy, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiBase } from "@/lib/api-base";

const BASE = getApiBase();
type Snapshot = {
  customerName: string | null; customerPhone: string; streakCode: string; activeDays: number;
  winningProgress: number; minDays: number; cycleLength: number; daysLeft: number; daysNeeded: number;
  isWinner: boolean; status: string; cycleStartDate: string; cycleEndDate: string;
  prize: { name: string; description: string | null } | null;
};

export default function MyStreak() {
  const [phone, setPhone] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const lookup = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true); setError(""); setSnapshot(null);
    try {
      const response = await fetch(`${BASE}/api/streaks/lookup?phone=${encodeURIComponent(phone)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No streak found");
      setSnapshot(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No streak found for this phone number");
    } finally { setLoading(false); }
  };

  return (
    <main className="min-h-screen px-4 py-10 text-white" style={{ background: "radial-gradient(circle at top, hsl(38 35% 13%), hsl(0 0% 4%) 45%)" }}>
      <div className="mx-auto max-w-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-orange-400/40 bg-orange-500/10"><Flame className="h-8 w-8 text-orange-400" /></div>
          <h1 className="cinema-title text-3xl text-amber-400">My Streak</h1>
          <p className="mt-2 text-sm text-zinc-400">Check your TG&apos;s Restaurant loyalty progress using the phone number on your orders.</p>
        </div>
        <form onSubmit={lookup} className="flex gap-2 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3">
          <Input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+971 5X XXX XXXX" className="border-zinc-700 bg-zinc-900" />
          <Button type="submit" disabled={loading}><Search className="mr-2 h-4 w-4" />{loading ? "Checking" : "Check"}</Button>
        </form>
        {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
        {snapshot && (
          <div className="mt-6 space-y-4">
            <div className="rounded-2xl border border-amber-500/30 bg-zinc-950/90 p-5">
              <div className="flex items-start justify-between gap-3"><div><div className="text-xs uppercase tracking-widest text-zinc-500">Streak code</div><div className="code-text mt-1 text-2xl text-amber-400">{snapshot.streakCode}</div><div className="mt-2 font-semibold text-white">{snapshot.customerName || "TG&apos;s customer"}</div></div>{snapshot.isWinner && <Trophy className="h-8 w-8 text-amber-400" />}</div>
              <div className="mt-6 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-zinc-900 p-3"><div className="text-2xl font-black text-orange-400">{snapshot.winningProgress}</div><div className="text-[10px] uppercase text-zinc-500">Winning days</div></div><div className="rounded-lg bg-zinc-900 p-3"><div className="text-2xl font-black text-emerald-400">{snapshot.minDays}</div><div className="text-[10px] uppercase text-zinc-500">Needed</div></div><div className="rounded-lg bg-zinc-900 p-3"><div className="text-2xl font-black text-blue-400">{snapshot.daysLeft}</div><div className="text-[10px] uppercase text-zinc-500">Days left</div></div></div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-800"><div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-300 transition-all" style={{ width: `${Math.min(100, (snapshot.winningProgress / snapshot.minDays) * 100)}%` }} /></div>
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500"><span>{snapshot.cycleStartDate}</span><CalendarDays className="h-3.5 w-3.5" /><span>{snapshot.cycleEndDate}</span></div>
            </div>
            <div className={`rounded-xl border p-4 ${snapshot.isWinner ? "border-emerald-500/30 bg-emerald-500/10" : "border-orange-500/20 bg-orange-500/5"}`}>
              <div className="font-bold text-amber-200">{snapshot.isWinner ? `You won ${snapshot.prize?.name ?? "your prize"}!` : snapshot.daysNeeded > 0 ? `${snapshot.daysNeeded} more active day(s) to win` : "You are on track to win!"}</div>
              <div className="mt-1 text-sm text-zinc-300">{snapshot.prize?.description ?? "Order on different UAE calendar days to build your streak."}</div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}