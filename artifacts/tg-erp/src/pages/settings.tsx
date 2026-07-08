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
  Eye, EyeOff, Edit2, Check, X, Loader2, Wifi, TestTube, Building2
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
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
  { id: "system", label: "System", icon: Settings },
  { id: "security", label: "Security", icon: Shield },
];

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
