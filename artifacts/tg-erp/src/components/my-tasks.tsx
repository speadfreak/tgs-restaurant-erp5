import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, ClipboardList, Clock } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/lib/auth";

interface Activity {
  id: number; title: string; dueDate: string | null; status: string;
  assignedByName: string | null; relatedEntityType: string | null; relatedEntityId: number | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
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

export function MyTasks() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const data = await apiFetch(`/api/activities?userId=${user.id}&status=pending`);
      setTasks(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);

  const markDone = async (id: number) => {
    setMarking(m => ({ ...m, [id]: true }));
    try {
      await apiFetch(`/api/activities/${id}/done`, "PATCH");
      setTasks(prev => prev.filter(t => t.id !== id));
    } catch { /* ignore */ }
    setMarking(m => ({ ...m, [id]: false }));
  };

  if (loading) return null;
  if (tasks.length === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-900/30 bg-amber-950/10 p-4 space-y-3">
      <h3 className="font-bold text-amber-400 flex items-center gap-2">
        <ClipboardList className="h-4 w-4" />
        My Tasks
        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 ml-1">{tasks.length}</Badge>
      </h3>
      <div className="space-y-2">
        {tasks.map(task => (
          <div key={task.id} className="flex items-start justify-between gap-3 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-zinc-200">{task.title}</div>
              <div className="text-xs text-zinc-500 flex items-center gap-2 mt-0.5">
                {task.assignedByName && <span>from {task.assignedByName}</span>}
                {task.dueDate && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Due {format(new Date(task.dueDate), "MMM d")}
                  </span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 h-7 border-green-700 text-green-400 hover:bg-green-950/40 text-xs"
              disabled={marking[task.id]}
              onClick={() => markDone(task.id)}
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Done
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
