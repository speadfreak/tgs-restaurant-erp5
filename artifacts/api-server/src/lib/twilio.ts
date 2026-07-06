import { db, whatsappMessagesTable } from "@workspace/db";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";

export async function sendWhatsAppMessage(
  to: string,
  body: string,
  orderId?: number,
  branchId?: number
): Promise<{ ok: boolean; sid?: string; error?: string }> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn("[Twilio] Not configured — TWILIO_ACCOUNT_SID/AUTH_TOKEN missing");
    return { ok: false, error: "Twilio not configured" };
  }
  const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const params = new URLSearchParams({
      From: TWILIO_WHATSAPP_FROM,
      To: toFormatted,
      Body: body,
    });
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
      },
      body: params.toString(),
    });
    const data = await resp.json() as { sid?: string; message?: string };
    if (!resp.ok) {
      await logWhatsAppMessage({ to, body, orderId, branchId, status: "failed", error: data.message });
      return { ok: false, error: data.message };
    }
    await logWhatsAppMessage({ to, body, orderId, branchId, status: "sent", sid: data.sid });
    return { ok: true, sid: data.sid };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await logWhatsAppMessage({ to, body, orderId, branchId, status: "failed", error: msg });
    return { ok: false, error: msg };
  }
}

async function logWhatsAppMessage(p: {
  to: string;
  body: string;
  orderId?: number;
  branchId?: number;
  status: string;
  sid?: string;
  error?: string;
}) {
  try {
    await db.insert(whatsappMessagesTable).values({
      customerPhone: p.to.replace("whatsapp:", ""),
      direction: "outbound",
      messageType: "text",
      content: p.body,
      orderId: p.orderId ?? null,
      branchId: p.branchId ?? null,
      twilioMessageSid: p.sid ?? null,
      status: p.status,
    });
  } catch { /* never crash */ }
}
