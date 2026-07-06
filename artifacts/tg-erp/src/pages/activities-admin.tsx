import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { ClipboardList, Plus, CheckCircle2, Clock, User } from "lucide-react";
import { format } from "date-fns";

interface Activity {
  id: number; title: string; dueDate: string | null; status: string;
  assignedToUserId: number; assignedToName: string | null;
  assignedByName: string | null; branchId: number;
  relatedEntityType: string | null; relatedEntityId: number | null; createdAt: string;
}
interface StaffUser { id: number; name: string; role: string; branchId: number | null }

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

export default function ActivitiesAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ assignedToUserId: "", title: "", dueDate: "", relatedEntityType: "", relatedEntityId: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (user?.branchId && user.role !== "super_admin") params.set("branchId", String(user.branchId));
      const [a, s] = await Promise.all([apiFetch(`/api/activities?${params}`), apiFetch(`/api/users`)]);
      setActivities(a);
      setStaff(s);
    } catch { /* ignore */ }
    setLoading(false);
  }, [user?.branchId, user?.role]);

  useEffect(() => { load(); }, [load]);

  const markDone = async (id: number) => {
    setPending(p => ({ ...p, [id]: true }));
    try {
      await apiFetch(`/api/activities/${id}/done`, "PATCH");
      setActivities(prev => prev.map(a => a.id === id ? { ...a, status: "done" } : a));
      toast({ title: "Marked done" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    setPending(p => ({ ...p, [id]: false }));
  };

  const createActivity = async () => {
    if (!newForm.assignedToUserId || !newForm.title) return;
    setCreating(true);
    try {
      const assignee = staff.find(s => s.id === parseInt(newForm.assignedToUserId));
      await apiFetch("/api/activities", "POST", {
        assignedToUserId: parseInt(newForm.assignedToUserId),
        assignedByUserId: user?.id,
        branchId: assignee?.branchId ?? user?.branchId,
        title: newForm.title,
        dueDate: newForm.dueDate || null,
        relatedEntityType: newForm.relatedEntityType || null,
        relatedEntityId: newForm.relatedEntityId ? parseInt(newForm.relatedEntityId) : null,
      });
      setNewForm({ assignedToUserId: "", title: "", dueDate: "", relatedEntityType: "", relatedEntityId: "" });
      setNewOpen(false);
      load();
      toast({ title: "Task assigned" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    setCreating(false);
  };

  const filtered = statusFilter === "all" ? activities : activities.filter(a => a.status === statusFilter);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ClipboardList className="h-7 w-7 text-amber-500" />Staff Activities
          </h1>
          <p className="text-muted-foreground mt-1">Assign and track tasks across your team</p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild>
            <Button className="bg-amber-500 hover:bg-amber-400 text-black font-bold"><Plus className="h-4 w-4 mr-2" />Assign Task</Button>
          </DialogTrigger>
          <DialogContent className="bg-zinc-900 border-zinc-700">
            <DialogHeader><DialogTitle>Assign a Task</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Assign to *</Label>
                <Select value={newForm.assignedToUserId} onValueChange={v => setNewForm(f => ({ ...f, assignedToUserId: v }))}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700"><SelectValue placeholder="Select staff member..." /></SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    {staff.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.role})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Task Title *</Label>
                <Input value={newForm.title} onChange={e => setNewForm(f => ({ ...f, title: e.target.value }))} placeholder="What needs to be done..." className="bg-zinc-800 border-zinc-700" />
              </div>
              <div className="space-y-2">
                <Label>Due Date (optional)</Label>
                <Input type="date" value={newForm.dueDate} onChange={e => setNewForm(f => ({ ...f, dueDate: e.target.value }))} className="bg-zinc-800 border-zinc-700" />
              </div>
              <Button onClick={createActivity} disabled={creating || !newForm.assignedToUserId || !newForm.title} className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold">
                {creating ? "Assigning..." : "Assign Task"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-amber-900/30 bg-amber-950/10 px-4 py-3 text-center">
          <div className="text-2xl font-black text-amber-400">{activities.filter(a => a.status === "pending").length}</div>
          <div className="text-xs text-zinc-500 font-medium">Pending</div>
        </div>
        <div className="rounded-xl border border-green-900/30 bg-green-950/10 px-4 py-3 text-center">
          <div className="text-2xl font-black text-green-400">{activities.filter(a => a.status === "done").length}</div>
          <div className="text-xs text-zinc-500 font-medium">Completed</div>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {["all", "pending", "done"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`text-sm px-4 py-1.5 rounded-full border font-medium transition-colors capitalize ${statusFilter === s ? "bg-amber-500 border-amber-500 text-black" : "border-zinc-700 text-zinc-400 hover:border-amber-500/50"}`}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="text-zinc-500 animate-pulse">Loading activities...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 p-12 text-center text-zinc-600">
          <ClipboardList className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p>No {statusFilter !== "all" ? statusFilter : ""} activities</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(activity => (
            <div key={activity.id} className={`rounded-2xl border p-4 ${activity.status === "done" ? "border-zinc-800 bg-zinc-900/30 opacity-60" : "border-zinc-700 bg-zinc-900/60"}`}>
              <div className="flex flex-col sm:flex-row justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold text-white">{activity.title}</div>
                  <div className="text-sm text-zinc-500 flex items-center gap-3 flex-wrap">
                    <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{activity.assignedToName}</span>
                    {activity.assignedByName && <span className="text-zinc-600">from {activity.assignedByName}</span>}
                    {activity.dueDate && (
                      <span className={`flex items-center gap-1 ${new Date(activity.dueDate) < new Date() && activity.status === "pending" ? "text-red-400" : ""}`}>
                        <Clock className="h-3.5 w-3.5" />Due {format(new Date(activity.dueDate), "MMM d")}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-600">Created {format(new Date(activity.createdAt), "MMM d, HH:mm")}</div>
                </div>
                <div className="flex items-center gap-2">
                  {activity.status === "done"
                    ? <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Done</Badge>
                    : <Button size="sm" variant="outline" className="border-green-700 text-green-400 hover:bg-green-950/40" disabled={pending[activity.id]} onClick={() => markDone(activity.id)}>
                        <CheckCircle2 className="h-4 w-4 mr-1" />{pending[activity.id] ? "..." : "Mark Done"}
                      </Button>
                  }
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
