import { useState } from "react";
import { Trophy, Phone, Search, Star, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import logoUrl from "@assets/ChatGPT_Image_Jun_30,_2026,_07_44_15_AM_1782796152927.png";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LuckyEntry {
  id: number;
  luckyNumber: number;
  drawDate: string;
  isWinner: boolean;
  prizeTier: string | null;
  luckyNumberSent: boolean;
  customerPhone: string;
}

export default function MyLuckyNumber() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<LuckyEntry[] | null>(null);
  const [error, setError] = useState("");

  const search = async () => {
    if (!phone.trim()) return;
    setLoading(true);
    setError("");
    setEntries(null);
    try {
      const p = phone.trim().replace(/\s+/g, "");
      const res = await fetch(`${BASE}/api/lottery/entries/by-phone?phone=${encodeURIComponent(p)}`);
      if (!res.ok) throw new Error("not_found");
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length === 0) setError("No entries found for this number today.");
    } catch {
      setError("No lucky number found for this phone. Make sure you ordered today!");
    }
    setLoading(false);
  };

  const today = new Date().toISOString().split("T")[0];
  const todayEntries = entries?.filter(e => e.drawDate === today) ?? [];
  const pastEntries = entries?.filter(e => e.drawDate !== today) ?? [];

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-12 px-4 pb-16" style={{ background: "hsl(0 0% 4%)" }}>
      {/* Header */}
      <div className="flex flex-col items-center mb-10">
        <div className="relative mb-4">
          <img src={logoUrl} alt="TG Restaurant" className="h-16 w-16 rounded-full ring-2 ring-amber-500/40 object-contain" />
          <span className="absolute -bottom-1 -right-1 text-lg">✨</span>
        </div>
        <h1 className="cinema-title text-3xl text-amber-400 text-center">ቲጂ ምግብ ቤት</h1>
        <p className="cinema-subtitle text-center text-lg mt-1">TG&apos;s Restaurant</p>
        <div className="mt-3 flex items-center gap-2 px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/10">
          <Trophy className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-bold text-amber-400">Daily Lucky Number Lookup</span>
        </div>
      </div>

      {/* Search card */}
      <div className="w-full max-w-sm">
        <div className="cinema-card rounded-2xl p-6 space-y-4">
          <div className="text-center">
            <p className="text-zinc-300 text-sm font-medium">Enter your WhatsApp number to find your lucky number for today&apos;s draw.</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 border rounded-xl overflow-hidden px-3" style={{ background: "hsl(0 0% 7%)", borderColor: "hsl(0 0% 18%)" }}>
              <Phone className="h-4 w-4 text-zinc-600 flex-shrink-0" />
              <Input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === "Enter" && search()}
                placeholder="+971 50 123 4567"
                className="border-0 bg-transparent focus-visible:ring-0 text-zinc-100 placeholder:text-zinc-600"
              />
            </div>
            <Button
              className="w-full h-11 font-black text-black text-sm rounded-xl flex items-center gap-2"
              style={{ background: "hsl(38 88% 52%)" }}
              disabled={loading || !phone.trim()}
              onClick={search}
            >
              {loading ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <><Search className="h-4 w-4" /> Find My Lucky Number</>
              )}
            </Button>
          </div>
          {error && (
            <div className="text-center text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl p-3">
              {error}
            </div>
          )}
        </div>

        {/* Today's entries */}
        {todayEntries.length > 0 && (
          <div className="mt-6 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-500 px-1">Today&apos;s Draw</h2>
            {todayEntries.map(entry => (
              <div key={entry.id} className={`cinema-card rounded-2xl p-5 text-center relative overflow-hidden ${entry.isWinner ? "border-amber-400/50" : ""}`}>
                {entry.isWinner && (
                  <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, transparent, hsl(38 88% 52%), transparent)" }} />
                )}
                {entry.isWinner ? (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "hsl(38 50% 12%)", border: "2px solid hsl(38 88% 52% / 0.5)" }}>
                        <Trophy className="h-8 w-8 text-amber-400" />
                      </div>
                    </div>
                    <div>
                      <p className="text-amber-400 font-black text-sm uppercase tracking-wider">🎉 You Won!</p>
                      <p className="text-zinc-200 text-sm mt-1">{entry.prizeTier}</p>
                    </div>
                    <div className="code-text text-5xl font-black text-amber-400">#{entry.luckyNumber}</div>
                    <p className="text-xs text-zinc-500">Show this screen at TG&apos;s Restaurant to claim your prize!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "hsl(38 20% 8%)", border: "1px solid hsl(38 88% 52% / 0.25)" }}>
                        <Star className="h-6 w-6 text-amber-500/60" />
                      </div>
                    </div>
                    <div>
                      <p className="text-zinc-400 text-xs uppercase tracking-wider font-bold">Your Lucky Number</p>
                      <div className="code-text text-5xl font-black text-amber-400 mt-2">#{entry.luckyNumber}</div>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-full bg-zinc-800/50 border border-zinc-700/50">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500/70" />
                      <span className="text-xs text-zinc-400 font-medium">Draw tonight at 10 PM — Good luck!</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Past entries */}
        {pastEntries.length > 0 && (
          <div className="mt-6 space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-600 px-1">Previous Draws</h2>
            {pastEntries.slice(0, 5).map(entry => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-3 rounded-xl border" style={{ borderColor: "hsl(0 0% 12%)", background: "hsl(0 0% 5%)" }}>
                <div>
                  <span className="code-text text-zinc-400 font-bold">#{entry.luckyNumber}</span>
                  <span className="text-xs text-zinc-600 ml-3">{entry.drawDate}</span>
                </div>
                {entry.isWinner ? (
                  <span className="text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">Winner 🏆</span>
                ) : (
                  <span className="text-xs text-zinc-700">Not drawn</span>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-zinc-700 mt-8">
          ቲጂ ምግብ ቤት · TG&apos;s Restaurant Dubai<br />
          Lucky draw runs daily for WhatsApp orders
        </p>
      </div>
    </div>
  );
}
