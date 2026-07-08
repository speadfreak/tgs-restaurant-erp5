import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { MessageSquare, ShoppingBag, ChefHat, Truck, CheckCircle2, XCircle, ClipboardList, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { getApiBase } from "@/lib/api-base";

interface TimelineEntry {
  id: number;
  type: "status" | "note";
  label: string;
  author?: string | null;
  timestamp: string;
}

interface HistoryEntry { id: number; status: string; changedBy?: number | null; changedAt: string; note?: string | null }
interface NoteEntry { id: number; authorName?: string | null; note: string; createdAt: string }

const STATUS_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  pending_acceptance: { label: "Order created", icon: <ShoppingBag className="h-3.5 w-3.5" />, color: "text-amber-400" },
  preparing:          { label: "Chef started preparing", icon: <ChefHat className="h-3.5 w-3.5" />, color: "text-orange-400" },
  ready:              { label: "Marked ready for pickup", icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-green-400" },
  assigned:           { label: "Rider assigned / claimed", icon: <Truck className="h-3.5 w-3.5" />, color: "text-blue-400" },
  out_for_delivery:   { label: "Out for delivery", icon: <Truck className="h-3.5 w-3.5" />, color: "text-blue-300" },
  delivered:          { label: "Delivered to customer", icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "text-green-300" },
  failed:             { label: "Delivery failed", icon: <XCircle className="h-3.5 w-3.5" />, color: "text-red-400" },
};

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

interface Props { entityType: string; entityId: number; readOnly?: boolean }

export function ActivityTimeline({ entityType, entityId, readOnly = false }: Props) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [history, notes] = await Promise.all([
        entityType === "order" ? apiFetch(`/api/orders/${entityId}/history`) : Promise.resolve([]),
        apiFetch(`/api/notes?entityType=${entityType}&entityId=${entityId}`),
      ]);

      const statusEntries: TimelineEntry[] = (history as HistoryEntry[]).map(h => ({
        id: h.id * 10000,
        type: "status" as const,
        label: STATUS_LABELS[h.status]?.label ?? h.status,
        author: null,
        timestamp: h.changedAt,
      }));
      const noteEntries: TimelineEntry[] = (notes as NoteEntry[]).map(n => ({
        id: n.id,
        type: "note" as const,
        label: n.note,
        author: n.authorName,
        timestamp: n.createdAt,
      }));

      const combined = [...statusEntries, ...noteEntries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setEntries(combined);
    } catch { /* ignore */ }
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);

  const postNote = async () => {
    if (!note.trim()) return;
    setPosting(true);
    try {
      await apiFetch("/api/notes", "POST", { entityType, entityId, authorId: user?.id, note: note.trim() });
      setNote("");
      load();
    } catch { /* ignore */ }
    setPosting(false);
  };

  if (loading) return <div className="text-zinc-500 text-sm animate-pulse">Loading timeline...</div>;

  return (
    <div className="space-y-4">
      <h3 className="font-bold text-zinc-200 flex items-center gap-2"><ClipboardList className="h-4 w-4 text-amber-500" />Activity Timeline</h3>
      <div className="space-y-0">
        {entries.length === 0 && <div className="text-zinc-600 text-sm">No activity yet.</div>}
        {entries.map((entry, i) => {
          const statusMeta = entry.type === "status" ? STATUS_LABELS[entries[i]?.label] : null;
          const isLast = i === entries.length - 1;
          return (
            <div key={entry.id} className="flex gap-3">
              {/* Timeline dot + connector */}
              <div className="flex flex-col items-center">
                <div className={`h-7 w-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${entry.type === "note" ? "border-zinc-600 bg-zinc-800" : "border-amber-700/60 bg-zinc-900"}`}>
                  {entry.type === "note"
                    ? <MessageSquare className="h-3.5 w-3.5 text-zinc-400" />
                    : <span className={statusMeta?.color ?? "text-amber-400"}>{statusMeta?.icon ?? <Clock className="h-3.5 w-3.5" />}</span>
                  }
                </div>
                {!isLast && <div className="w-0.5 flex-1 bg-zinc-800 my-1" />}
              </div>
              {/* Content */}
              <div className={`pb-4 flex-1 ${isLast ? "" : ""}`}>
                <div className={`text-sm font-semibold ${entry.type === "note" ? "text-zinc-300" : statusMeta?.color ?? "text-amber-400"}`}>
                  {entry.label}
                </div>
                <div className="text-xs text-zinc-600 flex items-center gap-2 mt-0.5">
                  <Clock className="h-3 w-3" />
                  {format(new Date(entry.timestamp), "MMM d, HH:mm")}
                  {entry.author && <span className="text-zinc-500">· {entry.author}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="space-y-2 border-t border-zinc-800 pt-4">
          <Textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Add an internal note..."
            className="bg-zinc-900 border-zinc-700 text-sm resize-none min-h-[70px]"
          />
          <Button size="sm" onClick={postNote} disabled={posting || !note.trim()} className="bg-amber-500 hover:bg-amber-400 text-black font-bold">
            {posting ? "Posting..." : "Add Note"}
          </Button>
        </div>
      )}
    </div>
  );
}
