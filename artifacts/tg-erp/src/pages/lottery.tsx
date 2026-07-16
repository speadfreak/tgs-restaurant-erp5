import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/use-socket";
import {
  Trophy, Star, Clock, Sparkles, Loader2, RefreshCw,
  AlertCircle, CheckCircle, Send, ChevronDown, ChevronUp,
  Settings, Gift, RotateCcw, ShieldAlert
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { getApiBase } from "@/lib/api-base";

interface LotteryEntry {
  id: number;
  orderId: number;
  orderCode: string | null;
  customerPhone: string;
  customerName: string | null;
  luckyNumber: number;
  drawDate: string;
  luckyNumberSent: boolean;
  manuallySent: boolean;
  sendAttempts: number;
  isWinner: boolean;
  prizeTier: string | null;
  createdAt: string;
}
interface LotteryDraw {
  id: number;
  branchId: number;
  drawDate: string;
  drawTime: string;
  status: string;
  totalEntries: number;
  prizeConfig: string;
  drawnAt: string | null;
}
interface LotteryWinner {
  id: number;
  entryId: number;
  prizeTier: string;
  prizeDescription: string;
  notificationStatus: string;
}
interface DrawWinnerDetail {
  winnerId: number;
  entryId: number;
  prizeTier: string;
  prizeDescription: string;
  notificationStatus: string;
  notificationSentAt: string | null;
  claimed: boolean;
  claimedAt: string | null;
  customerPhone: string;
  customerName: string | null;
  luckyNumber: number;
  orderId: number;
}
interface LotterySettings {
  drawTime: string;
  autoRunEnabled: boolean;
  prizeConfig: string;
}
interface PrizeTier { tier: string; count: number; prize: string }
interface Branch { id: number; name: string }

function parsePrizeTiers(json: string): PrizeTier[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map(t => ({
        tier: String(t.tier ?? ""),
        count: Number(t.count) > 0 ? Number(t.count) : 1,
        prize: String(t.prize ?? ""),
      }));
    }
  } catch { /* fall through to default */ }
  return [{ tier: "First Prize", count: 1, prize: "Free Meal" }];
}

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

// Confetti particle
interface Particle { id: number; x: number; color: string; size: number; duration: number; delay: number }

function ConfettiParticle({ p }: { p: Particle }) {
  return (
    <div
      className="fixed pointer-events-none z-[100] rounded-sm"
      style={{
        left: `${p.x}%`,
        top: "-10px",
        width: `${p.size}px`,
        height: `${p.size * 0.6}px`,
        background: p.color,
        animation: `confetti-fall ${p.duration}s ${p.delay}s linear forwards`,
        opacity: 0,
      }}
    />
  );
}

const CONFETTI_COLORS = ["#D4A853", "#F5E090", "#C94B1A", "#FFD700", "#FFF", "#4AAFFF", "#FF6B6B"];

function makeParticles(count = 60): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    size: 4 + Math.random() * 8,
    duration: 2.5 + Math.random() * 3,
    delay: Math.random() * 1.5,
  }));
}

export default function LotteryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  // Staff tied to one branch always use it; staff without one (e.g. super_admin) pick a branch.
  const activeBranchId = user?.branchId ?? (selectedBranchId ? parseInt(selectedBranchId, 10) : null);
  const socket = useSocket({ branchId: activeBranchId ?? undefined, userId: user?.id });
  const [entries, setEntries] = useState<LotteryEntry[]>([]);
  const [draws, setDraws] = useState<LotteryDraw[]>([]);
  const [settings, setSettings] = useState<LotterySettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"live" | "draw" | "settings">("live");

  // Draw reveal state
  const [showConfirm, setShowConfirm] = useState(false);
  const [runningDraw, setRunningDraw] = useState(false);
  const [showVoidConfirm, setShowVoidConfirm] = useState(false);
  const [voidingDraw, setVoidingDraw] = useState(false);
  const [drawPhase, setDrawPhase] = useState<"idle" | "countdown" | "shuffling" | "revealing" | "complete">("idle");
  const [countdown, setCountdown] = useState(3);
  const [winners, setWinners] = useState<(LotteryWinner & LotteryEntry)[]>([]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [particles, setParticles] = useState<Particle[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Settings form
  const [settingsForm, setSettingsForm] = useState({ drawTime: "22:00", prizeConfig: "" });
  const [prizeTiers, setPrizeTiers] = useState<PrizeTier[]>(parsePrizeTiers(""));
  const [savingSettings, setSavingSettings] = useState(false);

  // Past-draw winner history
  const [expandedDrawId, setExpandedDrawId] = useState<number | null>(null);
  const [drawWinners, setDrawWinners] = useState<Record<number, DrawWinnerDetail[]>>({});
  const [loadingWinners, setLoadingWinners] = useState(false);

  const totalConfiguredWinners = prizeTiers.reduce((sum, t) => sum + (t.count || 0), 0);

  const updateTier = (index: number, patch: Partial<PrizeTier>) => {
    setPrizeTiers(prev => {
      const next = prev.map((t, i) => i === index ? { ...t, ...patch } : t);
      setSettingsForm(f => ({ ...f, prizeConfig: JSON.stringify(next) }));
      return next;
    });
  };
  const addTier = () => {
    setPrizeTiers(prev => {
      const next = [...prev, { tier: `Prize ${prev.length + 1}`, count: 1, prize: "" }];
      setSettingsForm(f => ({ ...f, prizeConfig: JSON.stringify(next) }));
      return next;
    });
  };
  const removeTier = (index: number) => {
    setPrizeTiers(prev => {
      const next = prev.filter((_, i) => i !== index);
      setSettingsForm(f => ({ ...f, prizeConfig: JSON.stringify(next) }));
      return next;
    });
  };

  const toggleDrawWinners = async (drawId: number) => {
    if (expandedDrawId === drawId) { setExpandedDrawId(null); return; }
    setExpandedDrawId(drawId);
    if (!drawWinners[drawId]) {
      setLoadingWinners(true);
      try {
        const rows = await apiFetch(`/api/lottery/draws/${drawId}/winners`);
        setDrawWinners(prev => ({ ...prev, [drawId]: Array.isArray(rows) ? rows : [] }));
      } catch {
        toast({ title: "Could not load winners", variant: "destructive" });
      }
      setLoadingWinners(false);
    }
  };

  const toggleClaimed = async (winner: DrawWinnerDetail, drawId: number) => {
    try {
      const updated = await apiFetch(`/api/lottery/winners/${winner.winnerId}/claimed`, "PATCH", {
        claimed: !winner.claimed,
        userId: user?.id,
      });
      setDrawWinners(prev => ({
        ...prev,
        [drawId]: (prev[drawId] ?? []).map(w => w.winnerId === winner.winnerId ? { ...w, claimed: updated.claimed, claimedAt: updated.claimedAt } : w),
      }));
    } catch {
      toast({ title: "Update failed", variant: "destructive" });
    }
  };

  const today = new Date().toISOString().split("T")[0];
  const todayDraw = draws.find(d => d.drawDate === today);

  useEffect(() => {
    if (user?.branchId) return; // already scoped to one branch, no picker needed
    apiFetch("/api/branches").then(rows => setBranches(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, [user?.branchId]);

  const fetchAll = useCallback(async () => {
    if (!activeBranchId) { setEntries([]); setDraws([]); return; }
    setLoading(true);
    try {
      const [e, d, s] = await Promise.all([
        apiFetch(`/api/lottery/entries?branchId=${activeBranchId}&date=${today}`),
        apiFetch(`/api/lottery/draws?branchId=${activeBranchId}`),
        apiFetch(`/api/lottery/settings/${activeBranchId}`),
      ]);
      setEntries(Array.isArray(e) ? e : []);
      setDraws(Array.isArray(d) ? d : []);
      if (s) {
        setSettings(s);
        setSettingsForm({ drawTime: s.drawTime ?? "22:00", prizeConfig: s.prizeConfig ?? "" });
        setPrizeTiers(parsePrizeTiers(s.prizeConfig ?? ""));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeBranchId, today]);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 20000); return () => clearInterval(iv); }, [fetchAll]);

  // Live lottery entry event
  useEffect(() => {
    socket.on("lottery:new_entry", () => fetchAll());
    return () => { socket.off("lottery:new_entry"); };
  }, [socket, fetchAll]);

  const retryEntry = async (id: number) => {
    try {
      await apiFetch(`/api/lottery/entries/retry/${id}`, "POST");
      toast({ title: "Retry queued" });
      fetchAll();
    } catch {
      toast({ title: "Retry failed", variant: "destructive" });
    }
  };

  const createTodayDraw = async () => {
    if (!activeBranchId) {
      toast({ title: "Select a branch first", variant: "destructive" });
      return;
    }
    try {
      await apiFetch("/api/lottery/draws", "POST", {
        branchId: activeBranchId,
        drawDate: today,
        drawTime: settings?.drawTime ?? "22:00",
        prizeConfig: settings?.prizeConfig ?? '[{"tier":"First Prize","count":1,"prize":"Free Meal"}]',
      });
      fetchAll();
      toast({ title: "Draw session created for today" });
    } catch (err) {
      toast({ title: "Could not create draw session", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const runDraw = async () => {
    if (!todayDraw) return;
    setShowConfirm(false);
    setRunningDraw(true);
    setDrawPhase("countdown");
    setCountdown(3);

    // Countdown
    await new Promise<void>((resolve) => {
      let c = 3;
      countdownRef.current = setInterval(() => {
        c--;
        setCountdown(c);
        if (c <= 0) {
          clearInterval(countdownRef.current!);
          resolve();
        }
      }, 1000);
    });

    setDrawPhase("shuffling");
    await new Promise(r => setTimeout(r, 1500));

    try {
      const result = await apiFetch(`/api/lottery/draws/${todayDraw.id}/run`, "POST");
      setDrawPhase("revealing");
      const winnerList: (LotteryWinner & LotteryEntry)[] = result.winners ?? [];
      setWinners(winnerList);
      setRevealedCount(0);
      setParticles(makeParticles(80));

      // Reveal one by one
      for (let i = 1; i <= winnerList.length; i++) {
        await new Promise(r => setTimeout(r, 900));
        setRevealedCount(i);
      }

      await new Promise(r => setTimeout(r, 1000));
      setDrawPhase("complete");
      fetchAll();
      toast({ title: `🎉 Draw complete! ${winnerList.length} winner${winnerList.length !== 1 ? "s" : ""} selected` });
    } catch {
      toast({ title: "Draw failed", variant: "destructive" });
      setDrawPhase("idle");
    }
    setRunningDraw(false);
  };

  const saveSettings = async () => {
    if (!activeBranchId) { toast({ title: "Select a branch first", variant: "destructive" }); return; }
    setSavingSettings(true);
    try {
      await apiFetch(`/api/lottery/settings/${activeBranchId}`, "PUT", settingsForm);
      toast({ title: "Settings saved" });
      fetchAll();
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
    setSavingSettings(false);
  };

  // Eligible = sent via Twilio OR manually marked by admin
  const sentEntries = entries.filter(e => e.luckyNumberSent || e.manuallySent);
  // manuallySent toggle handler
  const toggleManuallySent = async (entry: LotteryEntry) => {
    try {
      await apiFetch(`/api/lottery/entries/${entry.id}/manually-sent`, "PATCH", { manuallySent: !entry.manuallySent });
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, manuallySent: !e.manuallySent } : e));
      toast({ title: entry.manuallySent ? "Marked as not sent" : "Marked as sent" });
    } catch { toast({ title: "Update failed", variant: "destructive" }); }
  };

  const copyLuckyNumber = (num: number) => {
    navigator.clipboard.writeText(String(num)).catch(() => {});
    toast({ title: `Copied #${num}` });
  };

  const resetDraw = async () => {
    if (!todayDraw) return;
    setVoidingDraw(true);
    try {
      await apiFetch(`/api/lottery/draws/${todayDraw.id}/reset`, "POST");
      setShowVoidConfirm(false);
      setDrawPhase("idle");
      setWinners([]);
      setRevealedCount(0);
      setParticles([]);
      fetchAll();
      toast({ title: "Draw voided — ready to re-run", description: "All winner records cleared. You can now run a fresh draw." });
    } catch (err) {
      toast({ title: "Could not void draw", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
    setVoidingDraw(false);
  };

  const copyWinnerMessage = (w: LotteryWinner & LotteryEntry) => {
    const msg = `🎉 እንኳን ደስ አለዎ! / Congratulations!\nTG's Restaurant (ቲጂ ምግብ ቤት)\nYour lucky number #${w.luckyNumber} has WON!\nPrize: ${w.prizeDescription}\nPlease contact us to claim your prize.`;
    navigator.clipboard.writeText(msg).catch(() => {});
    toast({ title: "Winner message copied — paste into WhatsApp" });
  };

  // ── DRAW OVERLAY ─────────────────────────────────────────────────────
  if (drawPhase !== "idle") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "hsl(0 0% 2%)" }}>
        {/* Confetti */}
        {particles.map(p => <ConfettiParticle key={p.id} p={p} />)}

        <div className="text-center max-w-2xl mx-auto px-6">
          {drawPhase === "countdown" && (
            <div className="animate-count-up">
              <div className="cinema-subtitle mb-4">Draw begins in</div>
              <div className="cinema-title text-[120px] leading-none shimmer-gold">{countdown || "GO!"}</div>
            </div>
          )}

          {drawPhase === "shuffling" && (
            <div>
              <div className="cinema-title text-4xl mb-6">🎰 Selecting Winners...</div>
              <div className="flex justify-center gap-2 flex-wrap">
                {entries.slice(0, 20).map((e, i) => (
                  <div key={e.id} className="code-text text-lg font-black rounded-lg px-3 py-1.5"
                    style={{
                      background: "hsl(38 30% 10%)",
                      border: "1px solid hsl(38 88% 52% / 0.4)",
                      color: "hsl(38 88% 52%)",
                      animation: `lottery-spin ${0.3 + (i % 5) * 0.1}s ${i * 0.05}s linear infinite`,
                    }}>
                    #{e.luckyNumber}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(drawPhase === "revealing" || drawPhase === "complete") && (
            <div>
              <h2 className="cinema-title text-3xl mb-2">🏆 Winners Revealed</h2>
              <p className="cinema-subtitle mb-8">Today's Lucky Numbers</p>
              <div className="space-y-4">
                {winners.slice(0, revealedCount).map((w, i) => (
                  <div key={w.id} className="lottery-winner-card rounded-2xl p-5 lottery-card-reveal">
                    <div className="flex items-center justify-between">
                      <div className="text-left">
                        <div className="text-xs font-bold uppercase tracking-widest text-amber-300/70 mb-1">{w.prizeTier}</div>
                        <div className="code-text text-4xl font-black shimmer-gold">#{w.luckyNumber}</div>
                        <div className="text-sm text-zinc-400 mt-1">{w.customerPhone?.replace(/(\d{3})\d{4}(\d{4})/, "$1 xxxx $2")}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-amber-400 font-bold">{w.prizeDescription}</div>
                        <Gift className="h-8 w-8 text-amber-400/50 mt-2 ml-auto" />
                      </div>
                    </div>
                    <button
                      onClick={() => copyWinnerMessage(w)}
                      className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border border-amber-700/40 text-amber-400 hover:bg-amber-950/30 transition-colors"
                    >
                      <Send className="h-3.5 w-3.5" />Copy Winner Message
                    </button>
                  </div>
                ))}
              </div>
              {drawPhase === "complete" && (
                <button
                  onClick={() => { setDrawPhase("idle"); setParticles([]); setTab("draw"); }}
                  className="btn-cinema mt-8"
                >
                  Done — View Summary
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "hsl(0 0% 4%)" }}>
      {/* ── HEADER ──────────────────────────── */}
      <div className="border-b relative" style={{ borderColor: "hsl(38 30% 10%)", background: "hsl(0 0% 2%)" }}>
        <div className="absolute top-0 left-0 right-0 h-[1px]"
          style={{ background: "linear-gradient(90deg, transparent, hsl(38 88% 52% / 0.6), transparent)" }} />
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: "hsl(38 50% 10%)", border: "1px solid hsl(38 88% 52% / 0.3)" }}>
                <Trophy className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <h1 className="cinema-title text-2xl">Lottery Engine</h1>
                <p className="cinema-subtitle">Manual Lucky Number Panel · {today}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!user?.branchId && (
                <select
                  value={selectedBranchId}
                  onChange={e => setSelectedBranchId(e.target.value)}
                  className="text-xs px-3 py-2 rounded-lg border bg-transparent text-zinc-200"
                  style={{ borderColor: "hsl(38 30% 15%)", background: "hsl(38 30% 6%)" }}
                >
                  <option value="">Select branch…</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
              <div className="text-center px-4 py-2 rounded-xl border" style={{ background: "hsl(38 30% 6%)", borderColor: "hsl(38 30% 15%)" }}>
                <div className="code-text text-2xl font-black text-amber-400 leading-none">{sentEntries.length}</div>
                <div className="cinema-subtitle mt-0.5">Entries Today</div>
              </div>
              <button onClick={fetchAll} disabled={loading} className="p-2 rounded-lg border border-zinc-700 text-zinc-500 hover:text-zinc-200 transition-colors">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 mt-4 border-b -mb-[1px]" style={{ borderColor: "hsl(0 0% 10%)" }}>
            {(["live", "draw", "settings"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${tab === t ? "border-amber-500 text-amber-400" : "border-transparent text-zinc-500 hover:text-zinc-300"}`}>
                {t === "live" ? `Today's Numbers (${entries.length})` : t === "draw" ? "Draw" : "Settings"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">

        {/* ── TODAY'S LUCKY NUMBERS TAB ──────── */}
        {tab === "live" && (
          <div className="space-y-4">
            {/* Instruction banner */}
            <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4 flex items-start gap-3">
              <Send className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200/80">
                Copy each lucky number and send it to the customer via WhatsApp manually. Numbers are generated automatically when orders are created.
              </p>
            </div>

            {entries.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-12 text-center" style={{ borderColor: "hsl(0 0% 14%)" }}>
                <Trophy className="h-10 w-10 mx-auto mb-3 text-zinc-700" />
                <p className="text-zinc-500">No lucky numbers issued yet today</p>
                <p className="text-zinc-700 text-xs mt-1">Numbers are generated automatically when new orders are created</p>
              </div>
            ) : (
              <div className="cinema-card rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "hsl(0 0% 12%)", background: "hsl(0 0% 6%)" }}>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Order Code</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Customer</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Phone</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Lucky Number</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Time</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Copied?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, i) => (
                      <tr key={entry.id} className="border-b transition-colors hover:bg-white/[0.02]"
                        style={{ borderColor: "hsl(0 0% 9%)", background: i % 2 === 0 ? "transparent" : "hsl(0 0% 5%)" }}>
                        <td className="px-4 py-3">
                          <span className="code-text text-xs text-zinc-400">{entry.orderCode ?? `#${entry.orderId}`}</span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300 font-medium">{entry.customerName ?? "—"}</td>
                        <td className="px-4 py-3 text-zinc-500 text-xs font-mono">{entry.customerPhone}</td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => copyLuckyNumber(entry.luckyNumber)}
                            title="Click to copy"
                            className="code-text text-xl font-black text-amber-400 hover:text-amber-300 hover:scale-105 transition-all cursor-pointer select-all"
                          >
                            #{entry.luckyNumber}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-zinc-600">
                          {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleManuallySent(entry)}
                            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-bold transition-all ${
                              entry.manuallySent
                                ? "border-emerald-700 bg-emerald-950/40 text-emerald-400"
                                : "border-zinc-700 text-zinc-500 hover:border-amber-600 hover:text-amber-400"
                            }`}
                          >
                            {entry.manuallySent ? <><CheckCircle className="h-3 w-3" />Sent</> : "Mark Sent"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── DRAW TAB ───────────────────────── */}
        {tab === "draw" && (
          <div className="space-y-6">
            {/* Today's draw status */}
            <div className="cinema-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="cinema-title-sm text-amber-400 text-base">Today's Draw</h3>
                  <p className="cinema-subtitle">{today}</p>
                </div>
                {!todayDraw && (
                  <button onClick={createTodayDraw} disabled={!activeBranchId} className="btn-cinema text-xs disabled:opacity-40 disabled:cursor-not-allowed" title={!activeBranchId ? "Select a branch first" : undefined}>
                    Create Draw Session
                  </button>
                )}
              </div>

              {todayDraw ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-3 rounded-xl" style={{ background: "hsl(0 0% 7%)" }}>
                      <div className="code-text text-3xl font-black text-amber-400">{sentEntries.length}</div>
                      <div className="cinema-subtitle mt-0.5">Eligible Entries</div>
                    </div>
                    <div className="text-center p-3 rounded-xl" style={{ background: "hsl(0 0% 7%)" }}>
                      <div className="cinema-title-sm text-base text-zinc-200">{todayDraw.drawTime}</div>
                      <div className="cinema-subtitle mt-0.5">Draw Time</div>
                    </div>
                    <div className="text-center p-3 rounded-xl" style={{ background: "hsl(0 0% 7%)" }}>
                      <div className={`text-base font-bold capitalize ${todayDraw.status === "completed" ? "text-emerald-400" : "text-amber-400"}`}>
                        {todayDraw.status}
                      </div>
                      <div className="cinema-subtitle mt-0.5">Status</div>
                    </div>
                  </div>

                  {todayDraw.status !== "completed" && sentEntries.length === 0 && (
                    <div className="rounded-xl border border-amber-700/30 bg-amber-950/10 p-4 text-sm text-amber-300/80">
                      <strong>No eligible entries yet.</strong> Go to the <button onClick={() => setTab("live")} className="underline hover:text-amber-400">Today's Numbers</button> tab, then mark each sent lucky number as "sent" using the toggle. Once at least one is marked, the draw button will appear here.
                    </div>
                  )}

                  {todayDraw.status !== "completed" && sentEntries.length > 0 && (
                    <>
                      <div className="rounded-xl border p-3 flex items-center justify-between text-sm" style={{ borderColor: "hsl(0 0% 14%)", background: "hsl(0 0% 6%)" }}>
                        <span className="text-zinc-400">Configured to select</span>
                        <span className="font-bold text-amber-400">
                          {Math.min(totalConfiguredWinners, sentEntries.length)} of {totalConfiguredWinners} winner{totalConfiguredWinners !== 1 ? "s" : ""}
                          {totalConfiguredWinners > sentEntries.length && <span className="text-zinc-600 font-normal"> (only {sentEntries.length} eligible)</span>}
                        </span>
                      </div>
                      {showConfirm ? (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4">
                          <p className="text-sm text-amber-300 font-medium mb-3">
                            You are about to draw <strong>{Math.min(totalConfiguredWinners, sentEntries.length)} winner{Math.min(totalConfiguredWinners, sentEntries.length) !== 1 ? "s" : ""}</strong> from <strong>{sentEntries.length} entries</strong>. This cannot be undone.
                          </p>
                          <div className="flex gap-3">
                            <button onClick={() => setShowConfirm(false)} className="flex-1 h-10 text-sm border border-zinc-700 text-zinc-400 rounded-lg hover:border-zinc-600 transition-colors">Cancel</button>
                            <button onClick={runDraw} disabled={runningDraw}
                              className="flex-1 h-10 text-sm font-black text-black rounded-lg"
                              style={{ background: "hsl(38 88% 52%)" }}>
                              {runningDraw ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "🎰 Run Draw Now"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowConfirm(true)}
                          className="w-full h-14 rounded-xl font-black text-base text-black transition-all hover:opacity-90"
                          style={{ background: "linear-gradient(135deg, hsl(38 88% 52%), hsl(38 88% 42%))", boxShadow: "0 0 30px hsl(38 88% 52% / 0.3)" }}
                        >
                          🏆 Run Today's Draw
                        </button>
                      )}
                    </>
                  )}

                  {todayDraw.status === "completed" && (
                    <div className="space-y-3">
                      <div className="text-center py-3">
                        <CheckCircle className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                        <p className="text-emerald-400 font-bold">Draw completed</p>
                        <p className="text-zinc-500 text-sm">Winners have been selected and notified</p>
                      </div>

                      {/* Void & Redraw section */}
                      {!showVoidConfirm ? (
                        <button
                          onClick={() => setShowVoidConfirm(true)}
                          className="w-full flex items-center justify-center gap-2 h-10 rounded-xl border text-xs font-bold transition-all hover:border-orange-600 hover:text-orange-400 hover:bg-orange-950/20"
                          style={{ borderColor: "hsl(0 0% 18%)", color: "hsl(0 0% 45%)" }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Void & Redraw
                        </button>
                      ) : (
                        <div className="rounded-xl border border-orange-700/50 bg-orange-950/20 p-4 space-y-3">
                          <div className="flex items-start gap-2.5">
                            <ShieldAlert className="h-4 w-4 text-orange-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-bold text-orange-300">Void this draw session?</p>
                              <p className="text-xs text-orange-300/70 mt-1 leading-relaxed">
                                This will permanently remove all winner records from today's draw and reset the session back to <strong className="text-orange-300">scheduled</strong>. You can then run a completely fresh draw with a new random seed.
                              </p>
                              <p className="text-xs text-orange-400/60 mt-1.5 font-medium">
                                ⚠️ Winner notifications already sent will NOT be recalled.
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2.5">
                            <button
                              onClick={() => setShowVoidConfirm(false)}
                              disabled={voidingDraw}
                              className="flex-1 h-9 text-xs border border-zinc-700 text-zinc-400 rounded-lg hover:border-zinc-500 transition-colors disabled:opacity-40"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={resetDraw}
                              disabled={voidingDraw}
                              className="flex-1 h-9 text-xs font-black rounded-lg border border-orange-700 text-orange-300 hover:bg-orange-900/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {voidingDraw
                                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Voiding…</>
                                : <><RotateCcw className="h-3.5 w-3.5" />Yes, Void & Reset</>
                              }
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-600">
                  <Trophy className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No draw session created for today</p>
                </div>
              )}
            </div>

            {/* Past draws */}
            {draws.filter(d => d.status === "completed").length > 0 && (
              <div>
                <h3 className="cinema-title-sm text-zinc-400 text-sm mb-3">Past Draws</h3>
                <div className="space-y-2">
                  {draws.filter(d => d.status === "completed").slice(0, 7).map(draw => {
                    const isOpen = expandedDrawId === draw.id;
                    const winnersList = drawWinners[draw.id] ?? [];
                    return (
                      <div key={draw.id} className="rounded-xl border overflow-hidden" style={{ background: "hsl(0 0% 5%)", borderColor: "hsl(0 0% 10%)" }}>
                        <button
                          onClick={() => toggleDrawWinners(draw.id)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                        >
                          <div>
                            <span className="code-text text-zinc-300 text-sm">{draw.drawDate}</span>
                            <span className="text-xs text-zinc-600 ml-3">{draw.totalEntries} entries</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="live-badge"><CheckCircle className="h-3 w-3" />Completed</span>
                            {isOpen ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: "hsl(0 0% 10%)" }}>
                            {loadingWinners && winnersList.length === 0 ? (
                              <div className="text-center py-4"><Loader2 className="h-4 w-4 animate-spin mx-auto text-zinc-600" /></div>
                            ) : winnersList.length === 0 ? (
                              <p className="text-xs text-zinc-600 text-center py-2">No winners recorded for this draw</p>
                            ) : (
                              winnersList.map(w => (
                                <div key={w.winnerId} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: "hsl(0 0% 7%)" }}>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="code-text font-black text-amber-400">#{w.luckyNumber}</span>
                                      <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide">{w.prizeTier}</span>
                                    </div>
                                    <div className="text-xs text-zinc-500 truncate">{w.customerName ?? "—"} · {w.customerPhone} · {w.prizeDescription}</div>
                                  </div>
                                  <button
                                    onClick={() => toggleClaimed(w, draw.id)}
                                    className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border font-bold transition-all ${
                                      w.claimed
                                        ? "border-emerald-700 bg-emerald-950/40 text-emerald-400"
                                        : "border-zinc-700 text-zinc-500 hover:border-amber-600 hover:text-amber-400"
                                    }`}
                                  >
                                    {w.claimed ? <><CheckCircle className="h-3 w-3" />Claimed</> : "Mark Claimed"}
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ───────────────────── */}
        {tab === "settings" && (
          <div className="max-w-lg space-y-5">
            <div className="cinema-card rounded-2xl p-6 space-y-4">
              <h3 className="cinema-title-sm text-amber-400 text-base flex items-center gap-2">
                <Settings className="h-4 w-4" />Lottery Configuration
              </h3>
              <div className="space-y-1.5">
                <Label className="text-zinc-400 text-xs uppercase tracking-wider">Daily Draw Time (UAE / UTC+4)</Label>
                <Input
                  type="time"
                  value={settingsForm.drawTime}
                  onChange={e => setSettingsForm(f => ({ ...f, drawTime: e.target.value }))}
                  className="border-zinc-700/60" style={{ background: "hsl(0 0% 7%)" }}
                />
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-400 text-xs uppercase tracking-wider">Prize Tiers &amp; Winner Count</Label>
                  <span className="text-xs font-bold text-amber-400">{totalConfiguredWinners} winner{totalConfiguredWinners !== 1 ? "s" : ""} total</span>
                </div>
                <div className="space-y-2">
                  {prizeTiers.map((tier, i) => (
                    <div key={i} className="rounded-xl border p-3 space-y-2" style={{ borderColor: "hsl(0 0% 16%)", background: "hsl(0 0% 6%)" }}>
                      <div className="flex items-center gap-2">
                        <Input
                          value={tier.tier}
                          onChange={e => updateTier(i, { tier: e.target.value })}
                          placeholder="Tier name (e.g. First Prize)"
                          className="border-zinc-700/60 text-sm flex-1" style={{ background: "hsl(0 0% 9%)" }}
                        />
                        <button
                          onClick={() => removeTier(i)}
                          disabled={prizeTiers.length <= 1}
                          title="Remove tier"
                          className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-500 hover:border-red-700 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                      <Input
                        value={tier.prize}
                        onChange={e => updateTier(i, { prize: e.target.value })}
                        placeholder="Prize description (e.g. Free Meal)"
                        className="border-zinc-700/60 text-sm" style={{ background: "hsl(0 0% 9%)" }}
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500 uppercase tracking-wider">Number of winners</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => updateTier(i, { count: Math.max(1, tier.count - 1) })}
                            className="h-7 w-7 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400 transition-colors font-bold"
                          >−</button>
                          <input
                            type="number"
                            min={1}
                            value={tier.count}
                            onChange={e => updateTier(i, { count: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                            className="w-14 text-center text-sm font-bold rounded-lg border py-1"
                            style={{ background: "hsl(0 0% 9%)", borderColor: "hsl(0 0% 18%)", color: "hsl(42 25% 88%)" }}
                          />
                          <button
                            onClick={() => updateTier(i, { count: tier.count + 1 })}
                            className="h-7 w-7 flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 hover:border-amber-600 hover:text-amber-400 transition-colors font-bold"
                          >+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={addTier}
                  className="w-full h-9 rounded-lg border border-dashed text-xs font-semibold text-zinc-400 hover:text-amber-400 hover:border-amber-600 transition-colors"
                  style={{ borderColor: "hsl(0 0% 20%)" }}
                >
                  + Add Prize Tier
                </button>
              </div>
              <button
                onClick={saveSettings}
                disabled={savingSettings}
                className="btn-cinema w-full flex items-center justify-center gap-2"
              >
                {savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save Settings"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
