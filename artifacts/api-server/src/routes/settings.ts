import { Router } from "express";
import { db, settingsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { authenticate, requireRole } from "../middlewares/auth";
import { getSetting, setSetting, getAllSettings, maskValue } from "../lib/settings";

const router: Router = Router();
router.use("/settings", authenticate, requireRole("super_admin"));

const SENSITIVE_KEYS = new Set([
  "twilio_account_sid",
  "twilio_auth_token",
  "sendgrid_api_key",
  "webhook_verification_token",
]);

const SETTING_DEFAULTS: Record<string, { label: string; isSensitive: boolean; section: string; description?: string }> = {
  twilio_account_sid:              { label: "Twilio Account SID",               isSensitive: true,  section: "whatsapp" },
  twilio_auth_token:               { label: "Twilio Auth Token",                isSensitive: true,  section: "whatsapp" },
  twilio_whatsapp_from:            { label: "WhatsApp Business Number",         isSensitive: false, section: "whatsapp", description: "Format: whatsapp:+971xxxxxxxxx" },
  whatsapp_sandbox_mode:           { label: "WhatsApp Sandbox Mode",            isSensitive: false, section: "whatsapp" },
  webhook_verification_token:      { label: "Webhook Verification Token",       isSensitive: true,  section: "whatsapp" },
  auto_reply_template_en:          { label: "Auto-reply Template (EN)",         isSensitive: false, section: "whatsapp" },
  auto_reply_template_am:          { label: "Auto-reply Template (AM)",         isSensitive: false, section: "whatsapp" },
  lucky_number_template_en:        { label: "Lucky Number Message (EN)",        isSensitive: false, section: "whatsapp" },
  lucky_number_template_am:        { label: "Lucky Number Message (AM)",        isSensitive: false, section: "whatsapp" },
  winner_notification_template_en: { label: "Winner Notification (EN)",        isSensitive: false, section: "whatsapp" },
  winner_notification_template_am: { label: "Winner Notification (AM)",        isSensitive: false, section: "whatsapp" },
  delivery_confirm_template_en:    { label: "Delivery Confirmation (EN)",       isSensitive: false, section: "whatsapp" },
  delivery_confirm_template_am:    { label: "Delivery Confirmation (AM)",       isSensitive: false, section: "whatsapp" },
  sendgrid_api_key:                { label: "SendGrid API Key",                 isSensitive: true,  section: "email" },
  sendgrid_from_email:             { label: "From Email Address",               isSensitive: false, section: "email" },
  sendgrid_from_name:              { label: "From Name",                        isSensitive: false, section: "email" },
  daily_report_recipients:         { label: "Daily Report Recipients",          isSensitive: false, section: "email" },
  daily_report_enabled:            { label: "Enable Daily Report Email",        isSensitive: false, section: "email" },
  lottery_draw_time:               { label: "Daily Draw Time (UAE)",            isSensitive: false, section: "lottery" },
  lottery_auto_run:                { label: "Auto-run Draw",                    isSensitive: false, section: "lottery" },
  lottery_eligibility_rule:        { label: "Eligibility Rule",                 isSensitive: false, section: "lottery" },
  lottery_min_order_aed:           { label: "Minimum Order AED",                isSensitive: false, section: "lottery" },
  etb_to_aed_rate:                 { label: "ETB to AED Exchange Rate",         isSensitive: false, section: "addis" },
  credit_overdue_threshold_days:   { label: "Credit Overdue Threshold (days)",  isSensitive: false, section: "addis" },
  import_cost_category_label:      { label: "Import Cost Category Label",       isSensitive: false, section: "addis" },
  restaurant_name:                 { label: "Restaurant Name",                  isSensitive: false, section: "system" },
  default_branch_id:               { label: "Default Branch",                   isSensitive: false, section: "system" },
  session_timeout_minutes:         { label: "Session Timeout (minutes)",        isSensitive: false, section: "system" },
  max_failed_login_attempts:       { label: "Max Failed Login Attempts",        isSensitive: false, section: "system" },
  lockout_duration_minutes:        { label: "Lockout Duration (minutes)",       isSensitive: false, section: "system" },
  audit_log_retention_days:        { label: "Audit Log Retention (days)",       isSensitive: false, section: "system" },
  // Microsoft integrations
  teams_webhook_url:               { label: "Teams Incoming Webhook URL",       isSensitive: true,  section: "microsoft", description: "Paste the Incoming Webhook URL from your Teams channel connector" },
  teams_notify_new_orders:         { label: "Notify on New Orders",             isSensitive: false, section: "microsoft", description: "Post a card to Teams when a new order is created (true/false)" },
  teams_notify_delivered:          { label: "Notify on Delivery Complete",      isSensitive: false, section: "microsoft", description: "Post a card to Teams when an order is delivered (true/false)" },
  teams_notify_lottery:            { label: "Notify on Lottery Draw",           isSensitive: false, section: "microsoft", description: "Post a card to Teams when the daily lottery draw completes (true/false)" },
  teams_notify_large_expense:      { label: "Notify on Large Expense",          isSensitive: false, section: "microsoft", description: "Post a card to Teams when an expense exceeds this AED amount (0 = disabled)" },
  excel_auto_export_enabled:       { label: "Enable Scheduled Excel Exports",   isSensitive: false, section: "microsoft", description: "Automatically generate and send daily .xlsx reports (true/false)" },
};

router.get("/settings", async (_req, res): Promise<void> => {
  const stored = await getAllSettings();
  const storedMap = new Map(stored.map(s => [s.key, s]));

  const result = Object.entries(SETTING_DEFAULTS).map(([key, meta]) => {
    const stored = storedMap.get(key);
    return {
      key,
      label: meta.label,
      section: meta.section,
      description: meta.description ?? null,
      isSensitive: meta.isSensitive,
      masked: stored?.masked ?? null,
      hasValue: !!stored?.masked,
      updatedAt: stored?.updatedAt ?? null,
    };
  });

  res.json(result);
});

router.put("/settings/:key", async (req, res): Promise<void> => {
  const { key } = req.params;
  const { value } = req.body as { value?: string };
  if (!value && value !== "") { res.status(400).json({ error: "value is required" }); return; }
  if (!SETTING_DEFAULTS[key]) { res.status(400).json({ error: "Unknown setting key" }); return; }
  const isSensitive = SENSITIVE_KEYS.has(key);
  await setSetting(key, value, isSensitive, req.user!.id);
  res.json({ ok: true, key, masked: isSensitive ? maskValue(value) : value });
});

router.post("/settings/:key/reveal", async (req, res): Promise<void> => {
  const { key } = req.params;
  const { password } = req.body as { password?: string };
  if (!password) { res.status(400).json({ error: "Password required to reveal sensitive values" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Incorrect password" }); return; }
  const value = await getSetting(key);
  if (value === null) { res.status(404).json({ error: "Setting not found" }); return; }
  res.json({ key, value });
});

router.post("/settings/test-twilio", async (req, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  if (!to) { res.status(400).json({ error: "to number required" }); return; }
  try {
    const { sendWhatsAppMessage } = await import("../lib/twilio");
    const result = await sendWhatsAppMessage(to, "TG ERP — Test message. Connection working!");
    if (result.ok) {
      res.json({ ok: true, message: "Test message sent successfully", sid: result.sid });
    } else {
      res.json({ ok: false, message: result.error ?? "Unknown error" });
    }
  } catch (err: unknown) {
    res.json({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
  }
});

router.post("/settings/test-sendgrid", async (req, res): Promise<void> => {
  const { to } = req.body as { to?: string };
  if (!to) { res.status(400).json({ error: "to email required" }); return; }
  const apiKey = await getSetting("sendgrid_api_key");
  if (!apiKey) { res.json({ ok: false, message: "SendGrid API key not configured" }); return; }
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: (await getSetting("sendgrid_from_email")) ?? "noreply@tg-erp.com" },
        subject: "TG ERP — Test Email",
        content: [{ type: "text/plain", value: "Connection test successful." }],
      }),
    });
    res.json({ ok: response.ok, message: response.ok ? "Test email sent" : `SendGrid error ${response.status}` });
  } catch (err: unknown) {
    res.json({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
  }
});

export default router;
