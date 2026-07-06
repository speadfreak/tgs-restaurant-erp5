import { useState } from "react";
import { useListTimesheets, useListPayslips, useListUsers, useCreateTimesheet, useUpdateTimesheet, useGeneratePayslip, useListCommissions } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Plus, Clock, FileText } from "lucide-react";

const EMPTY_TIME = { userId: "", clockIn: "", clockOut: "" };
const EMPTY_PAY = { userId: "", periodStart: "", periodEnd: "" };

export default function Payroll() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries();

  const { data: timesheets, isLoading: loadTime } = useListTimesheets({ branchId: user?.branchId ?? undefined });
  const { data: payslips, isLoading: loadPay } = useListPayslips({ branchId: user?.branchId ?? undefined });
  const { data: commissions } = useListCommissions({});
  const { data: staff } = useListUsers({ branchId: user?.branchId ?? undefined });

  const [timeDialog, setTimeDialog] = useState<{ open: boolean; editId?: number }>({ open: false });
  const [timeForm, setTimeForm] = useState(EMPTY_TIME);
  const [payDialog, setPayDialog] = useState(false);
  const [payForm, setPayForm] = useState(EMPTY_PAY);

  const createTime = useCreateTimesheet({ mutation: { onSuccess: () => { toast({ title: "Entry added" }); invalidate(); setTimeDialog({ open: false }); setTimeForm(EMPTY_TIME); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const updateTime = useUpdateTimesheet({ mutation: { onSuccess: () => { toast({ title: "Clock-out recorded" }); invalidate(); setTimeDialog({ open: false }); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });
  const generatePay = useGeneratePayslip({ mutation: { onSuccess: () => { toast({ title: "Payslip generated" }); invalidate(); setPayDialog(false); setPayForm(EMPTY_PAY); }, onError: () => toast({ title: "Error", variant: "destructive" }) } });

  const saveTime = () => {
    if (timeDialog.editId) {
      updateTime.mutate({ id: timeDialog.editId, data: { clockOut: timeForm.clockOut } });
    } else {
      createTime.mutate({ data: { userId: Number(timeForm.userId), branchId: user?.branchId ?? Number(staff?.find(s => String(s.id) === timeForm.userId)?.branchId ?? 0), clockIn: new Date(timeForm.clockIn).toISOString(), clockOut: timeForm.clockOut ? new Date(timeForm.clockOut).toISOString() : undefined } });
    }
  };

  const openClockOut = (id: number) => {
    setTimeForm(f => ({ ...f, clockOut: new Date().toISOString().slice(0, 16) }));
    setTimeDialog({ open: true, editId: id });
  };

  const activeStaff = staff?.filter(s => s.active && s.role !== "super_admin");

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Payroll & HR</h1>
        <p className="text-muted-foreground mt-1 text-sm">Timesheets, commissions, and payslips.</p>
      </div>

      <Tabs defaultValue="timesheets" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="timesheets">Timesheets</TabsTrigger>
          <TabsTrigger value="commissions">Commissions</TabsTrigger>
          <TabsTrigger value="payslips">Payslips</TabsTrigger>
        </TabsList>

        <TabsContent value="timesheets">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Clock-in Records</CardTitle>
              <Button size="sm" onClick={() => { setTimeForm({ ...EMPTY_TIME, clockIn: new Date().toISOString().slice(0, 16) }); setTimeDialog({ open: true }); }}>
                <Plus className="mr-2 h-4 w-4" /> Add Entry
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>In</TableHead>
                    <TableHead>Out</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadTime ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : timesheets?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No timesheet entries yet</TableCell></TableRow>
                  ) : timesheets?.map(t => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.userName || `User #${t.userId}`}</TableCell>
                      <TableCell>{format(new Date(t.clockIn), "MMM d, yyyy")}</TableCell>
                      <TableCell className="text-green-500 font-mono">{format(new Date(t.clockIn), "HH:mm")}</TableCell>
                      <TableCell className="font-mono">
                        {t.clockOut ? <span className="text-orange-500">{format(new Date(t.clockOut), "HH:mm")}</span> : <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Active</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-mono">{t.hoursWorked != null ? Number(t.hoursWorked).toFixed(2) : "—"}</TableCell>
                      <TableCell className="text-right">
                        {!t.clockOut && <Button variant="outline" size="sm" onClick={() => openClockOut(t.id)}>Clock Out</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="commissions">
          <Card>
            <CardHeader><CardTitle>Commission Log</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff ID</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissions?.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Commissions auto-log when deliveries complete</TableCell></TableRow>
                  ) : commissions?.map(c => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">Staff #{c.userId}</TableCell>
                      <TableCell className="font-mono text-xs">#{c.orderId}</TableCell>
                      <TableCell className="capitalize">{c.type}</TableCell>
                      <TableCell>{format(new Date(c.createdAt), "MMM d, HH:mm")}</TableCell>
                      <TableCell className="text-right font-bold text-green-500">{c.amountAed} AED</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payslips">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Payslips</CardTitle>
              <Button size="sm" onClick={() => { setPayForm(EMPTY_PAY); setPayDialog(true); }}>
                <Plus className="mr-2 h-4 w-4" /> Generate Payslip
              </Button>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead className="hidden sm:table-cell">Period</TableHead>
                    <TableHead>Base</TableHead>
                    <TableHead className="hidden sm:table-cell">Commission</TableHead>
                    <TableHead className="text-right">Net Pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadPay ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
                  ) : payslips?.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payslips yet</TableCell></TableRow>
                  ) : payslips?.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.userName || `User #${p.userId}`}</TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{p.periodStart} — {p.periodEnd}</TableCell>
                      <TableCell>{p.baseSalary} AED</TableCell>
                      <TableCell className="hidden sm:table-cell text-green-500">+{p.commissionTotal ?? 0} AED</TableCell>
                      <TableCell className="text-right font-bold text-primary">{p.netPay} AED</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={timeDialog.open} onOpenChange={open => setTimeDialog(d => ({ ...d, open }))}>
        <DialogContent>
          <DialogHeader><DialogTitle>{timeDialog.editId ? "Record Clock-Out" : "Add Timesheet Entry"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!timeDialog.editId && (
              <>
                <div className="space-y-2">
                  <Label>Staff Member</Label>
                  <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={timeForm.userId} onChange={e => setTimeForm(f => ({ ...f, userId: e.target.value }))}>
                    <option value="">Select staff</option>
                    {activeStaff?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2"><Label>Clock In</Label><Input type="datetime-local" value={timeForm.clockIn} onChange={e => setTimeForm(f => ({ ...f, clockIn: e.target.value }))} /></div>
              </>
            )}
            <div className="space-y-2"><Label>Clock Out (optional)</Label><Input type="datetime-local" value={timeForm.clockOut} onChange={e => setTimeForm(f => ({ ...f, clockOut: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTimeDialog({ open: false })}>Cancel</Button>
            <Button onClick={saveTime} disabled={createTime.isPending || updateTime.isPending || (!timeDialog.editId && (!timeForm.userId || !timeForm.clockIn))}>
              {createTime.isPending || updateTime.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payDialog} onOpenChange={setPayDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate Payslip</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Staff Member</Label>
              <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={payForm.userId} onChange={e => setPayForm(f => ({ ...f, userId: e.target.value }))}>
                <option value="">Select staff</option>
                {activeStaff?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Period Start</Label><Input type="date" value={payForm.periodStart} onChange={e => setPayForm(f => ({ ...f, periodStart: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Period End</Label><Input type="date" value={payForm.periodEnd} onChange={e => setPayForm(f => ({ ...f, periodEnd: e.target.value }))} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Net pay = base salary + commissions earned in period</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(false)}>Cancel</Button>
            <Button onClick={() => generatePay.mutate({ data: { userId: Number(payForm.userId), periodStart: payForm.periodStart, periodEnd: payForm.periodEnd } })} disabled={generatePay.isPending || !payForm.userId || !payForm.periodStart || !payForm.periodEnd}>
              {generatePay.isPending ? "Generating..." : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
