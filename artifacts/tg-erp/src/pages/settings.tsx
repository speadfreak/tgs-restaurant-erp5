import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Settings, MessageSquare, Mail, Trophy, Globe, Shield,
  Eye, EyeOff, Edit2, Check, X, Loader2, Wifi, TestTube, Building2, RefreshCw,
  HardDrive, PlayCircle, ChevronDown, ExternalLink,
} from "lucide-react";
import { getApiBase } from "@/lib/api-base";

const BASE = getApiBase();
function getToken() { return localStorage.getItem("tg_erp_token"); }
function apiFetch(path: string, method = "GET", body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${getToken() ?? ""}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

type SettingRow = {
  key: string;
  label: string;
  section: string;
  description: string | null;
  isSensitive: boolean;
  masked: string | null;
  hasValue: boolean;
  updatedAt: string | null;
};

const SECTIONS: { id: string; label: string; icon: React.ElementType }[] = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
  { id: "email", label: "Email", icon: Mail },
  { id: "lottery", label: "Lottery", icon: Trophy },
  { id: "addis", label: "Addis", icon: Globe },
  { id: "microsoft", label: "Microsoft", icon: Building2 },
  { id: "google_drive", label: "Google Drive & Backup", icon: HardDrive },
  { id: "system", label: "System", icon: Settings },
  { id: "security", label: "Security", icon: Shield },
];

type BackupLog = {
  id: number;
  weekLabel: string;
  fileName: string;
  fileId: string | null;
  webViewLink: string | null;
  rowsCleared: number | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState("whatsapp");
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [revealing, setRevealing] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ key: string; ok: boolean; message: string } | null>(null);

  // Exchange rate state (Addis section)
  const [exchangeRate, setExchangeRate] = useState<string>("");
  const [exchangeRateLoading, setExchangeRateLoading] = useState(false);
  const [exchangeRateSaving, setExchangeRateSaving] = useState(false);
  const [exchangeRateInput, setExchangeRateInput] = useState<string>("");
  const [editingRate, setEditingRate] = useState(false);
  const [fetchingLiveRate, setFetchingLiveRate] = useState(false);
  const [liveRateMeta, setLiveRateMeta] = useState<{ source: string; fetchedAt: string } | null>(null);

  // Google Drive & Backup section state
  const [backupLogs, setBackupLogs] = useState<BackupLog[]>([]);
  const [backupLogsLoading, setBackupLogsLoading] = useState(false);
  const [drivingTest, setDrivingTest] = useState(false);
  const [driveTestResult, setDriveTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [runningBackup, setRunningBackup] = useState(false);
  const [backupRunMessage, setBackupRunMessage] = useState<string | null>(null);
  const [setupGuideOpen, setSetupGuideOpen] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/settings");
      if (res.ok) setSettings(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const fetchExchangeRate = useCallback(async () => {
    setExchangeRateLoading(true);
    try {
      const res = await apiFetch("/api/addis/exchange-rate");
      if (res.ok) {
        const data = await res.json();
        // Backend returns { fromCurrency, toCurrency, rate: "0.0200" }
        const rate = data?.rate ?? "";
        setExchangeRate(String(rate));
        setExchangeRateInput(String(rate));
      }
    } catch { /* ignore */ }
    setExchangeRateLoading(false);
  }, []);

  const saveExchangeRate = async () => {
    const val = parseFloat(exchangeRateInput);
    if (isNaN(val) || val <= 0) { toast({ title: "Invalid rate", description: "Enter a positive number", variant: "destructive" }); return; }
    setExchangeRateSaving(true);
    try {
      const res = await apiFetch("/api/addis/exchange-rate", "PUT", { fromCurrency: "ETB", toCurrency: "AED", rate: val });
      if (res.ok) {
        setExchangeRate(String(val));
        setEditingRate(false);
        toast({ title: "Exchange rate saved", description: `1 ETB = ${val} AED` });
      } else {
        toast({ title: "Save failed", variant: "destructive" });
      }
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    setExchangeRateSaving(false);
  };

  useEffect(() => {
    if (activeSection === "addis") fetchExchangeRate();
  }, [activeSection, fetchExchangeRate]);

  const fetchBackupLogs = useCallback(async () => {
    setBackupLogsLoading(true);
    try {
      const res = await apiFetch("/api/backup/logs");
      if (res.ok) setBackupLogs(await res.json());
    } catch { /* ignore */ }
    setBackupLogsLoading(false);
  }, []);

  useEffect(() => {
    if (activeSection === "google_drive") fetchBackupLogs();
  }, [activeSection, fetchBackupLogs]);

  const testDriveConnection = async () => {
    setDrivingTest(true);
    setDriveTestResult(null);
    try {
      const res = await apiFetch("/api/backup/test-drive");
      const j = await res.json();
      setDriveTestResult({ ok: !!j.success, message: j.success ? `Connected as: ${j.connectedAs}` : (j.error ?? "Connection failed") });
    } catch (err) {
      setDriveTestResult({ ok: false, message: String(err) });
    }
    setDrivingTest(false);
  };

  const runBackupNow = async () => {
    setRunningBackup(true);
    setBackupRunMessage(null);
    try {
      const res = await apiFetch("/api/backup/run", "POST");
      const j = await res.json();
      setBackupRunMessage(j.message ?? "Backup started");
      toast({ title: "Backup started", description: "Check backup history in a few minutes" });
      setTimeout(() => fetchBackupLogs(), 60000);
    } catch {
      toast({ title: "Failed to start backup", variant: "destructive" });
    }
    setRunningBackup(false);
  };

  const fetchLiveRate = async () => {
    setFetchingLiveRate(true);
    try {
      const res = await apiFetch("/api/addis/exchange-rate/live");
      const j = await res.json();
      if (res.ok && j.rate) {
        setExchangeRateInput(String(j.rate));
        setEditingRate(true);
        setLiveRateMeta({ source: j.source, fetchedAt: j.fetchedAt });
        toast({ title: "Live rate fetched", description: `1 ETB = ${j.rate} AED (${j.source}) — review and save` });
      } else {
        toast({ title: "Could not fetch live rate", description: j.error ?? "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Could not fetch live rate", variant: "destructive" });
    }
    setFetchingLiveRate(false);
  };

  if (user && user.role !== "super_admin") {
    return <div className="p-8 text-muted-foreground">Super Admin access required.</div>;
  }

  const sectionSettings = settings.filter(s => s.section === activeSection);

  const startEdit = (s: SettingRow) => {
    const currentVal = revealed[s.key] ?? (s.isSensitive ? "" : s.masked ?? "");
    setEditing(e => ({ ...e, [s.key]: currentVal }));
  };
  const cancelEdit = (key: string) => setEditing(e => { const n = { ...e }; delete n[key]; return n; });

  const save = async (key: string) => {
    const value = editing[key];
    setSaving(key);
    try {
      const res = await apiFetch(`/api/settings/${key}`, "PUT", { value });
      if (res.ok) {
        toast({ title: "Saved", description: key });
        cancelEdit(key);
        fetchSettings();
      } else {
        const j = await res.json().catch(() => ({}));
        toast({ title: "Save failed", description: (j as { error?: string }).error ?? String(res.status), variant: "destructive" });
      }
    } finally {
      setSaving(null);
    }
  };

  const reveal = async (key: string) => {
    const password = window.prompt("Enter your password to reveal this value:");
    if (!password) return;
    setRevealing(key);
    try {
      const res = await apiFetch(`/api/settings/${key}/reveal`, "POST", { password });
      if (res.ok) {
        const j = await res.json();
        setRevealed(r => ({ ...r, [key]: j.value }));
        toast({ title: "Value revealed", description: "It will be hidden on next page load" });
      } else {
        const j = await res.json().catch(() => ({}));
        toast({ title: "Reveal failed", description: (j as { error?: string }).error ?? "Incorrect password", variant: "destructive" });
      }
    } finally {
      setRevealing(null);
    }
  };

  const hideRevealed = (key: string) => setRevealed(r => { const n = { ...r }; delete n[key]; return n; });

  const testConnection = async (type: "twilio" | "sendgrid") => {
    if (!testTo) { toast({ title: "Enter a recipient first", variant: "destructive" }); return; }
    setTestingKey(type);
    setTestResult(null);
    try {
      const endpoint = type === "twilio" ? "/api/settings/test-twilio" : "/api/settings/test-sendgrid";
      const res = await apiFetch(endpoint, "POST", { to: testTo });
      const j = await res.json();
      setTestResult({ key: type, ok: j.ok, message: j.message });
    } catch (err) {
      setTestResult({ key: type, ok: false, message: String(err) });
    } finally {
      setTestingKey(null);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Settings className="h-6 w-6 text-amber-500" /> System Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure integrations, security, and operational parameters. Sensitive values are AES-256 encrypted at rest.
        </p>
      </div>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map(sec => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                  : "text-zinc-400 hover:text-zinc-200 border border-transparent hover:border-zinc-700"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {sec.label}
            </button>
          );
        })}
      </div>

      {/* Test connection panel (WhatsApp + Email sections) */}
      {(activeSection === "whatsapp" || activeSection === "email") && (
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><TestTube className="h-4 w-4 text-amber-400" /> Test Connection</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{activeSection === "whatsapp" ? "WhatsApp number (e.g. +971…)" : "Email address"}</Label>
                <Input
                  value={testTo}
                  onChange={e => setTestTo(e.target.value)}
                  placeholder={activeSection === "whatsapp" ? "+971500000000" : "test@example.com"}
                  className="w-56 h-8 text-sm"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={testingKey !== null}
                onClick={() => testConnection(activeSection === "whatsapp" ? "twilio" : "sendgrid")}
                className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              >
                {testingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Wifi className="h-3.5 w-3.5 mr-1" />}
                Send Test
              </Button>
              {testResult && (
                <span className={`text-sm font-medium ${testResult.ok ? "text-green-400" : "text-red-400"}`}>
                  {testResult.ok ? "Connected" : "Failed"}: {testResult.message}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exchange rate card (Addis section only) */}
      {activeSection === "addis" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-amber-400" /> ETB → AED Exchange Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Rate used in Addis supply-chain cost calculations. 1 ETB = X AED.
            </p>
            <div className="mb-3">
              <Button
                size="sm"
                variant="outline"
                disabled={fetchingLiveRate}
                onClick={fetchLiveRate}
                className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
              >
                {fetchingLiveRate ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Wifi className="h-3.5 w-3.5 mr-1.5" />}
                Fetch Live Rate
              </Button>
              {liveRateMeta && (
                <span className="text-[11px] text-muted-foreground ml-2">
                  via {liveRateMeta.source} · {new Date(liveRateMeta.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            {exchangeRateLoading ? (
              <div className="flex items-center gap-2 text-zinc-500 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div>
            ) : editingRate ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  step="0.0001"
                  value={exchangeRateInput}
                  onChange={e => setExchangeRateInput(e.target.value)}
                  className="h-8 w-36 text-sm font-mono"
                  placeholder="0.0200"
                  autoFocus
                />
                <Button size="icon" className="h-8 w-8 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30" disabled={exchangeRateSaving} onClick={saveExchangeRate}>
                  {exchangeRateSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-500" onClick={() => { setEditingRate(false); setExchangeRateInput(exchangeRate); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="font-mono text-amber-400 font-bold text-sm">1 ETB = {exchangeRate || "—"} AED</span>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-500 hover:text-amber-400" onClick={() => { setEditingRate(true); setExchangeRateInput(exchangeRate); }} title="Edit rate">
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-500 hover:text-amber-400" onClick={fetchExchangeRate} title="Refresh">
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Google Drive & Backup section */}
      {activeSection === "google_drive" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Wifi className="h-4 w-4 text-amber-400" /> Google Drive Connection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Configure the OAuth credentials below (see setup guide), then test the connection. This uses your own Google account's storage — Google service accounts have no storage quota of their own and cannot upload files.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={drivingTest}
                  onClick={testDriveConnection}
                  className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                >
                  {drivingTest ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <TestTube className="h-3.5 w-3.5 mr-1.5" />}
                  Test Connection
                </Button>
                {driveTestResult && (
                  <span className={`text-sm font-medium ${driveTestResult.ok ? "text-green-400" : "text-red-400"}`}>
                    {driveTestResult.ok ? "✅" : "❌"} {driveTestResult.message}
                  </span>
                )}
              </div>

              <button
                onClick={() => setSetupGuideOpen(o => !o)}
                className="mt-4 flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300"
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${setupGuideOpen ? "rotate-180" : ""}`} />
                📖 Setup Guide {setupGuideOpen ? "(hide)" : "(click to expand)"}
              </button>
              {setupGuideOpen && (
                <ol className="mt-2 space-y-1.5 text-xs text-zinc-400 list-decimal list-inside bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                  <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-amber-400 underline">console.cloud.google.com</a></li>
                  <li>Create a new project (or use an existing one)</li>
                  <li>Enable "Google Drive API" in APIs & Services → Library</li>
                  <li>Go to APIs & Services → OAuth consent screen → set User type "External", add your own Gmail as a Test user, and add the <code className="text-amber-300">.../auth/drive.file</code> scope</li>
                  <li>Go to APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type "Web application"</li>
                  <li>Under "Authorized redirect URIs" add <code className="text-amber-300">https://developers.google.com/oauthplayground</code></li>
                  <li>Copy the resulting <code className="text-amber-300">Client ID</code> and <code className="text-amber-300">Client Secret</code> into the fields below</li>
                  <li>Open <a href="https://developers.google.com/oauthplayground" target="_blank" rel="noreferrer" className="text-amber-400 underline">developers.google.com/oauthplayground</a> → click the gear icon → check "Use your own OAuth credentials" → paste in the same Client ID/Secret</li>
                  <li>In Step 1, find and select the scope <code className="text-amber-300">https://www.googleapis.com/auth/drive.file</code> → Authorize APIs → sign in with your own Google account</li>
                  <li>In Step 2, click "Exchange authorization code for tokens" → copy the <code className="text-amber-300">Refresh token</code> into "OAuth Refresh Token" below</li>
                  <li>In Google Drive, create a folder called "TG Restaurant Backups" (in your own Drive — no need to share it with anyone)</li>
                  <li>Open the folder and copy the ID from the URL (the part after <code className="text-amber-300">/folders/</code>) into "Google Drive Folder ID" below</li>
                  <li>Click "Test Connection" above to verify — it should show "Connected as: your-own-email@gmail.com"</li>
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-amber-400" /> Automatic Weekly Backup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Schedule: every Sunday at 12:00 AM UAE time. Toggle "Enable Auto Weekly Backup" below to turn the schedule on/off.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  disabled={runningBackup}
                  onClick={runBackupNow}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
                >
                  {runningBackup ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
                  Run Backup Now
                </Button>
                <span className="text-xs text-zinc-500">Takes 30-60 seconds — runs in background</span>
              </div>
              {backupRunMessage && <p className="text-xs text-green-400 mt-2">{backupRunMessage}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-amber-400" /> Backup History (Last 20)
              </CardTitle>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-zinc-500 hover:text-amber-400" onClick={fetchBackupLogs} title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              {backupLogsLoading ? (
                <div className="flex items-center gap-2 text-zinc-500 text-sm py-4"><Loader2 className="h-4 w-4 animate-spin" />Loading...</div>
              ) : backupLogs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No backups have run yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                        <th className="py-2 pr-3 font-medium">Week</th>
                        <th className="py-2 pr-3 font-medium">File</th>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Orders</th>
                        <th className="py-2 pr-3 font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {backupLogs.map(log => (
                        <tr key={log.id}>
                          <td className="py-2 pr-3 font-mono text-xs text-zinc-300">{log.weekLabel}</td>
                          <td className="py-2 pr-3 text-xs text-zinc-400 max-w-[220px] truncate" title={log.fileName}>{log.fileName}</td>
                          <td className="py-2 pr-3">
                            {log.status === "success" ? (
                              <Badge className="bg-green-600/15 text-green-400 border border-green-600/30">✅ Success</Badge>
                            ) : (
                              <Badge className="bg-red-600/15 text-red-400 border border-red-600/30" title={log.errorMessage ?? undefined}>❌ Failed</Badge>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs text-zinc-300">{log.status === "success" ? (log.rowsCleared ?? 0) : "—"}</td>
                          <td className="py-2 pr-3">
                            {log.webViewLink ? (
                              <a href={log.webViewLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300">
                                Open <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-zinc-600">Error</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-400" /> What Gets Backed Up & Cleared
              </CardTitle>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-medium text-zinc-300 mb-1.5">Backed up & cleared weekly:</p>
                <ul className="space-y-1 text-zinc-400">
                  <li>✅ Orders & order items</li>
                  <li>✅ Deliveries</li>
                  <li>✅ Lottery entries, draws & winners</li>
                  <li>✅ Finance entries & expenses</li>
                  <li>✅ Staff commissions</li>
                  <li>✅ Timesheets</li>
                  <li>✅ WhatsApp message logs</li>
                  <li>✅ Import shipments & payments</li>
                  <li>✅ Login attempts</li>
                  <li>✅ Completed staff activities</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-zinc-300 mb-1.5">Never touched:</p>
                <ul className="space-y-1 text-zinc-400">
                  <li>🔒 Staff accounts (names, phones, passwords, roles)</li>
                  <li>🔒 Branches</li>
                  <li>🔒 Menu items & categories</li>
                  <li>🔒 Inventory items & restock rules</li>
                  <li>🔒 Suppliers</li>
                  <li>🔒 System settings</li>
                  <li>🔒 Customers (kept for lottery history)</li>
                  <li>🔒 Backup logs themselves</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Settings list */}
      <Card>
        <CardContent className="pt-4 divide-y divide-border">
          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div>
          ) : sectionSettings.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No settings in this section.</p>
          ) : (
            sectionSettings.map(s => {
              const isEditing = s.key in editing;
              const isRevealed = s.key in revealed;
              const displayVal = isRevealed ? revealed[s.key] : s.masked;

              return (
                <div key={s.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-200">{s.label}</span>
                      {s.isSensitive && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-500">encrypted</Badge>
                      )}
                      {!s.hasValue && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-zinc-700 text-zinc-500">not set</Badge>
                      )}
                    </div>
                    {s.description && <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>}
                    <p className="text-xs text-zinc-600 mt-0.5 font-mono">{s.key}</p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isEditing ? (
                      <>
                        <Input
                          value={editing[s.key]}
                          onChange={e => setEditing(ed => ({ ...ed, [s.key]: e.target.value }))}
                          type={s.isSensitive && !isRevealed ? "password" : "text"}
                          className="h-8 w-48 text-sm font-mono"
                          placeholder={s.isSensitive ? "Enter new value…" : "Value"}
                          autoFocus
                        />
                        <Button
                          size="icon"
                          className="h-8 w-8 bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-600/30"
                          disabled={saving === s.key}
                          onClick={() => save(s.key)}
                        >
                          {saving === s.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-zinc-500" onClick={() => cancelEdit(s.key)}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {displayVal && (
                          <span className={`text-xs font-mono max-w-[160px] truncate ${isRevealed ? "text-amber-300" : "text-zinc-400"}`} title={displayVal}>
                            {displayVal}
                          </span>
                        )}
                        {s.isSensitive && s.hasValue && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-zinc-500 hover:text-amber-400"
                            title={isRevealed ? "Hide value" : "Reveal value"}
                            disabled={revealing === s.key}
                            onClick={() => isRevealed ? hideRevealed(s.key) : reveal(s.key)}
                          >
                            {revealing === s.key
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />
                            }
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-zinc-500 hover:text-amber-400"
                          title="Edit"
                          onClick={() => startEdit(s)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
