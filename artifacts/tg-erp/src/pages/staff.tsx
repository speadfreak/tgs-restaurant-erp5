import { useState, useCallback, useEffect } from "react";
import { useListUsers, useCreateUser, useUpdateUser, useListBranches } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Users, Edit, UserX, Activity, RefreshCw,
  CheckCircle2, XCircle, Clock, Play, Loader2, Copy, KeyRound, ShieldCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { UserInputRole } from "@workspace/api-client-react";
import { getApiBase } from "@/lib/api-base";

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

// ── Types ──
interface CronRun { startedAt: string; status: string; message: string | null }
interface CronJob {
  name: string; label: string; schedule: string; icon: string;
  lastRun: { startedAt: string; completedAt: string | null; status: string; message: string | null; errorDetails: string | null } | null;
  recentRuns: CronRun[];
}

const ROLES: UserInputRole[] = ["super_admin", "branch_manager", "kitchen_staff", "delivery_staff", "order_staff", "addis_staff"];
const EMPTY_FORM = { name: "", phone: "", role: "order_staff" as UserInputRole, branchId: "", baseSalary: "", password: "" };

const ROLE_TABS = [
  { id: "all", label: "All" },
  { id: "kitchen_staff", label: "Chefs" },
  { id: "delivery_staff", label: "Delivery" },
  { id: "order_staff", label: "Order Intake" },
  { id: "addis_staff", label: "Addis" },
  { id: "branch_manager", label: "Managers" },
  { id: "super_admin", label: "Admins" },
];

function generatePassword(): string {
  const digits = Math.floor(1000 + Math.random() * 9000);
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const l1 = letters[Math.floor(Math.random() * letters.length)];
  const l2 = letters[Math.floor(Math.random() * letters.length)];
  return `TG@${digits}${l1}${l2}`;
}

// ── Cron Job Monitor ──
function CronMonitor() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState<Record<string, boolean>>({});

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/cron-jobs/status");
      setJobs(Array.isArray(data) ? data : []);
    } catch {
      toast({ title: "Could not load cron status", variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const trigger = async (name: string, label: string) => {
    setTriggering(t => ({ ...t, [name]: true }));
    try {
      await apiFetch(`/api/cron-jobs/${name}/trigger`, "POST");
      toast({ title: `${label} triggered`, description: "Job ran successfully" });
      await fetchStatus();
    } catch {
      toast({ title: "Trigger failed", variant: "destructive" });
    }
    setTriggering(t => ({ ...t, [name]: false }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Cron Job Monitor
        </CardTitle>
        <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {loading && jobs.length === 0 ? (
          <div className="flex items-center justify-center h-20 gap-2 text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />Loading job status...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {jobs.map(job => {
              const isRunning = triggering[job.name];
              const lastStatus = job.lastRun?.status;
              return (
                <div
                  key={job.name}
                  className="rounded-xl border p-4 space-y-3 transition-all"
                  style={{
                    background: "hsl(var(--card))",
                    borderColor: lastStatus === "success" ? "hsl(142 50% 20%)" : lastStatus === "failed" ? "hsl(0 50% 20%)" : "hsl(var(--border))",
                  }}
                >
                  {/* Job header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{job.icon}</span>
                      <div>
                        <div className="font-semibold text-sm">{job.label}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />{job.schedule}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs flex-shrink-0"
                      disabled={isRunning}
                      onClick={() => trigger(job.name, job.label)}
                    >
                      {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      {isRunning ? "Running..." : "Run Now"}
                    </Button>
                  </div>

                  {/* Last run info */}
                  {job.lastRun ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        {job.lastRun.status === "success" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                        ) : job.lastRun.status === "failed" ? (
                          <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                        ) : (
                          <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin flex-shrink-0" />
                        )}
                        <Badge
                          variant={job.lastRun.status === "success" ? "default" : job.lastRun.status === "failed" ? "destructive" : "secondary"}
                          className="text-[10px] capitalize h-5"
                        >
                          {job.lastRun.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatDistanceToNow(new Date(job.lastRun.startedAt), { addSuffix: true })}
                        </span>
                      </div>
                      {job.lastRun.message && (
                        <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1 leading-relaxed">
                          {job.lastRun.message}
                        </p>
                      )}
                      {job.lastRun.errorDetails && (
                        <p className="text-xs text-red-400 bg-red-950/20 rounded px-2 py-1 leading-relaxed border border-red-900/30">
                          {job.lastRun.errorDetails.slice(0, 200)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground italic px-1">No runs recorded yet</div>
                  )}

                  {/* Micro history — last 3 runs */}
                  {job.recentRuns.length > 1 && (
                    <div className="flex items-center gap-1.5 pt-1 border-t" style={{ borderColor: "hsl(var(--border) / 0.5)" }}>
                      <span className="text-[10px] text-muted-foreground mr-1">History:</span>
                      {job.recentRuns.slice(0, 5).map((run, i) => (
                        <div
                          key={i}
                          title={`${run.status} — ${new Date(run.startedAt).toLocaleString()}\n${run.message ?? ""}`}
                          className={`h-2 w-2 rounded-full flex-shrink-0 ${run.status === "success" ? "bg-emerald-500" : run.status === "failed" ? "bg-red-500" : "bg-amber-500"}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 pt-4 border-t flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />Success</span>
          <span className="flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5 text-red-500" />Failed</span>
          <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 text-amber-500" />Running</span>
          <span className="text-muted-foreground/60 ml-auto">Colored dots = run history (newest left)</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──
export default function Staff() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();

  const { data: staff, isLoading } = useListUsers({ branchId: user?.branchId ?? undefined });
  const { data: branches } = useListBranches();

  const [dialog, setDialog] = useState<{ open: boolean; editId: number | null }>({ open: false, editId: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [deactivateId, setDeactivateId] = useState<number | null>(null);
  const [credentials, setCredentials] = useState<{ name: string; phone: string; password: string } | null>(null);
  const [roleFilter, setRoleFilter] = useState("all");
  const [resetResult, setResetResult] = useState<{ name: string; phone: string; password: string } | null>(null);
  const [resettingId, setResettingId] = useState<number | null>(null);

  const createUser = useCreateUser({
    mutation: {
      onSuccess: (_data, variables) => {
        toast({ title: "Staff member created" });
        invalidate();
        setDialog({ open: false, editId: null });
        setCredentials({ name: variables.data.name, phone: variables.data.phone, password: variables.data.password });
      },
      onError: (e: unknown) => { const msg = (e as { message?: string })?.message ?? "Failed to create staff"; toast({ title: "Error", description: msg, variant: "destructive" }); },
    },
  });
  const updateUser = useUpdateUser({ mutation: { onSuccess: () => { toast({ title: "Updated" }); invalidate(); setDialog({ open: false, editId: null }); setDeactivateId(null); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });

  const openAdd = () => { setForm(EMPTY_FORM); setDialog({ open: true, editId: null }); };
  const openEdit = (s: { id: number; name: string; phone: string; role: string; branchId?: number | null; baseSalary?: number | null }) => {
    setForm({ name: s.name, phone: s.phone, role: s.role as UserInputRole, branchId: String(s.branchId ?? ""), baseSalary: s.baseSalary != null ? String(s.baseSalary) : "", password: "" });
    setDialog({ open: true, editId: s.id });
  };

  const save = () => {
    if (dialog.editId) {
      updateUser.mutate({ id: dialog.editId, data: { name: form.name, phone: form.phone, role: form.role, branchId: form.branchId ? Number(form.branchId) : null, baseSalary: form.baseSalary ? Number(form.baseSalary) : null, ...(form.password ? { password: form.password } : {}) } });
    } else {
      createUser.mutate({ data: { name: form.name, phone: form.phone, role: form.role, branchId: form.branchId ? Number(form.branchId) : undefined, baseSalary: form.baseSalary ? Number(form.baseSalary) : undefined, password: form.password } });
    }
  };

  const mutating = createUser.isPending || updateUser.isPending;
  const needsBranch = form.role !== "super_admin";

  const resetPassword = async (s: { id: number; name: string; phone: string }) => {
    setResettingId(s.id);
    try {
      const data = await apiFetch(`/api/users/${s.id}/reset-password`, "POST");
      setResetResult({ name: s.name, phone: s.phone, password: data.tempPassword });
    } catch {
      toast({ title: "Reset failed", variant: "destructive" });
    }
    setResettingId(null);
  };

  const filteredStaff = roleFilter === "all"
    ? (staff ?? [])
    : (staff ?? []).filter(s => s.role === roleFilter);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-3">
            <Users className="h-7 w-7 sm:h-8 sm:w-8 text-primary" /> Staff Management
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage users, roles, access, and automated jobs.</p>
        </div>
        <Button onClick={openAdd}><Plus className="mr-2 h-4 w-4" /> Add Staff</Button>
      </div>

      {/* Role filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {ROLE_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setRoleFilter(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              roleFilter === tab.id
                ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                : "text-zinc-400 hover:text-zinc-200 border border-transparent hover:border-zinc-700"
            }`}
          >
            {tab.label}
            {tab.id !== "all" && (
              <span className="ml-1.5 text-zinc-600">
                {staff?.filter(s => s.role === tab.id && s.active).length ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Staff Directory */}
      <Card>
        <CardHeader><CardTitle>Directory ({filteredStaff.filter(s => s.active).length} active{roleFilter !== "all" ? ` — ${ROLE_TABS.find(t => t.id === roleFilter)?.label}` : ""})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Phone</TableHead>
                <TableHead className="hidden md:table-cell">Branch</TableHead>
                <TableHead className="hidden md:table-cell">Salary</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : filteredStaff.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No staff in this category</TableCell></TableRow>
              ) : filteredStaff.map(s => (
                <TableRow key={s.id} className={!s.active ? "opacity-50" : ""}>
                  <TableCell className="font-medium">
                    <div>{s.name}</div>
                    {!(s as unknown as Record<string, unknown>).passwordChanged && (
                      <span className="text-[10px] text-amber-500 font-medium">Password not changed</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="outline" className="capitalize text-xs">{s.role.replace(/_/g, " ")}</Badge></TableCell>
                  <TableCell className="hidden sm:table-cell font-mono text-sm">{s.phone}</TableCell>
                  <TableCell className="hidden md:table-cell">{branches?.find(b => b.id === s.branchId)?.name ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell">{s.baseSalary != null ? `${s.baseSalary} AED` : "—"}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {s.active
                        ? <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">Active</Badge>
                        : <Badge variant="secondary" className="text-[10px]">Inactive</Badge>}
                      {s.role === "kitchen_staff" && Boolean((s as unknown as Record<string, unknown>).chefStatus) && (
                        <div className={`text-[10px] font-medium ${(s as unknown as Record<string, unknown>).chefStatus === "preparing" ? "text-amber-400" : "text-zinc-500"}`}>
                          {(s as unknown as Record<string, unknown>).chefStatus === "preparing" ? "Preparing" : "Available"}
                        </div>
                      )}
                      {s.role === "delivery_staff" && Boolean((s as unknown as Record<string, unknown>).currentStatus) && (
                        <div className={`text-[10px] font-medium ${(s as unknown as Record<string, unknown>).currentStatus === "on_delivery" ? "text-blue-400" : "text-zinc-500"}`}>
                          {String((s as unknown as Record<string, unknown>).currentStatus ?? "").replace(/_/g, " ")}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(s)}><Edit className="h-3.5 w-3.5" /></Button>
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 hover:text-amber-400"
                        title="Reset password"
                        disabled={resettingId === s.id}
                        onClick={() => resetPassword({ id: s.id, name: s.name, phone: s.phone })}
                      >
                        {resettingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                      </Button>
                      {s.active && s.id !== user?.id && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 hover:text-destructive" title="Deactivate" onClick={() => setDeactivateId(s.id)}><UserX className="h-3.5 w-3.5" /></Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── CRON JOB MONITOR ── */}
      <CronMonitor />

      {/* Edit / Add Dialog */}
      <Dialog open={dialog.open} onOpenChange={open => setDialog(d => ({ ...d, open }))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{dialog.editId ? "Edit Staff Member" : "Register New Staff"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Full Name</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Tigist Haile" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+251911001001" /></div>
              <div className="space-y-2">
                <Label>Role</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as UserInputRole }))}>
                  {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                </select>
              </div>
            </div>
            {needsBranch && (
              <div className="space-y-2">
                <Label>Branch</Label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.branchId} onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}>
                  <option value="">Select branch</option>
                  {branches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-2"><Label>Base Salary (AED/month)</Label><Input type="number" value={form.baseSalary} onChange={e => setForm(f => ({ ...f, baseSalary: e.target.value }))} placeholder="2500" /></div>
            <div className="space-y-2">
              <Label>{dialog.editId ? "New Password (blank = keep current)" : "Password"}</Label>
              <div className="flex gap-2">
                <Input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={dialog.editId ? "Leave blank to keep" : "Min 6 characters"} />
                <Button type="button" variant="outline" size="icon" title="Generate secure password" onClick={() => setForm(f => ({ ...f, password: generatePassword() }))}>
                  <KeyRound className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, editId: null })}>Cancel</Button>
            <Button onClick={save} disabled={mutating || !form.name || !form.phone || (!dialog.editId && !form.password) || (needsBranch && !form.branchId)}>
              {mutating ? "Saving..." : dialog.editId ? "Update" : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials Display-Once Dialog */}
      <Dialog open={!!credentials} onOpenChange={open => !open && setCredentials(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-500" /> Account Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Share these login credentials with <strong>{credentials?.name}</strong> now. For security, the password will not be shown again.
            </p>
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Phone (login)</div>
                  <div className="font-mono text-sm">{credentials?.phone}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => credentials && navigator.clipboard.writeText(credentials.phone)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Password</div>
                  <div className="font-mono text-sm">{credentials?.password}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => credentials && navigator.clipboard.writeText(credentials.password)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                if (credentials) navigator.clipboard.writeText(`Phone: ${credentials.phone}\nPassword: ${credentials.password}`);
                setCredentials(null);
              }}
            >
              Copy Both &amp; Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Result Dialog */}
      <Dialog open={!!resetResult} onOpenChange={open => !open && setResetResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-amber-500" /> Password Reset</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Temporary password for <strong>{resetResult?.name}</strong>. They must change it on first login.
            </p>
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Phone (login)</div>
                  <div className="font-mono text-sm">{resetResult?.phone}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => resetResult && navigator.clipboard.writeText(resetResult.phone)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs text-muted-foreground">Temp Password</div>
                  <div className="font-mono text-sm text-amber-400">{resetResult?.password}</div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => resetResult && navigator.clipboard.writeText(resetResult.password)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { if (resetResult) navigator.clipboard.writeText(`Phone: ${resetResult.phone}\nTemp Password: ${resetResult.password}`); setResetResult(null); }}>
              Copy &amp; Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deactivateId} onOpenChange={open => !open && setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Deactivate Staff Member?</AlertDialogTitle><AlertDialogDescription>They lose login access. Historical data is preserved.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivateId && updateUser.mutate({ id: deactivateId, data: { active: false } })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
