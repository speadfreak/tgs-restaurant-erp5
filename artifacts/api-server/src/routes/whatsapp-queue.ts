import { Router } from "express";
import { db, ordersTable, orderStatusHistoryTable, orderItemsTable, whatsappMessagesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { sendWhatsAppMessage } from "../lib/twilio";
import { getIO } from "../lib/socket";
import { authenticate, requireRole, ADMIN_ROLES, ORDER_INTAKE_ROLES } from "../middlewares/auth";

// Roles that may read and act on the WhatsApp intake queue
const QUEUE_ROLES = [...ADMIN_ROLES, ...ORDER_INTAKE_ROLES];

const router = Router();

function tryEmitTo(room: string, event: string, data: unknown) {
  try { getIO().to(room).emit(event, data); } catch { /* socket not ready */ }
}

// Twilio inbound webhook
router.post("/webhooks/whatsapp", async (req, res): Promise<void> => {
  res.status(200).send("<Response></Response>"); // Always ACK Twilio immediately
  try {
    const from: string = req.body?.From ?? "";
    const body: string = req.body?.Body ?? "";
    const messageSid: string = req.body?.MessageSid ?? "";
    const numMedia = parseInt(req.body?.NumMedia ?? "0", 10);
    const mediaUrl: string | null = numMedia > 0 ? (req.body?.MediaUrl0 ?? null) : null;
    const messageType = mediaUrl ? "voice" : "text";
    const phone = from.replace("whatsapp:", "");
    const branchId = 1; // Default branch — production would route by registered WA number

    // Get today's max queue number for this branch
    const today = new Date().toISOString().split("T")[0];
    const [maxRow] = await db.select({ max: sql<number>`COALESCE(MAX(queue_number), 0)` })
      .from(ordersTable)
      .where(and(eq(ordersTable.branchId, branchId), sql`DATE(created_at AT TIME ZONE 'UTC') = ${today}`));
    const queueNumber = (maxRow?.max ?? 0) + 1;

    const orderCode = `WQ${Date.now().toString(36).toUpperCase()}`;
    const [order] = await db.insert(ordersTable).values({
      orderCode,
      branchId,
      channel: "whatsapp_voice",
      status: "queue",
      queueNumber,
      whatsappMessageId: messageSid,
      whatsappMessageType: messageType,
      whatsappMediaUrl: mediaUrl,
      customerPhoneDirect: phone,
      autoReplySent: false,
    }).returning();

    await db.insert(whatsappMessagesTable).values({
      branchId,
      orderId: order.id,
      customerPhone: phone,
      direction: "inbound",
      messageType,
      content: body || null,
      mediaUrl,
      twilioMessageSid: messageSid,
      status: "received",
    });

    await db.insert(orderStatusHistoryTable).values({
      orderId: order.id,
      status: "queue",
      note: `WhatsApp ${messageType} — queue #${queueNumber}`,
    });

    // Auto-reply
    const replyBody = `ሰላም! 👋 ትዕዛዝዎን ተቀብለናል።\nየሰልፍ ቁጥርዎ #${queueNumber} ነው።\n\nHello! We received your message.\nYour queue number is #${queueNumber}.\nOur staff will confirm your order shortly.`;
    const twilioResult = await sendWhatsAppMessage(phone, replyBody, order.id, branchId);
    if (twilioResult.ok) {
      await db.update(ordersTable).set({ autoReplySent: true }).where(eq(ordersTable.id, order.id));
    }

    tryEmitTo(`branch:${branchId}:admin`, "order:queue_new", {
      orderId: order.id,
      orderCode,
      queueNumber,
      phone,
      messageType,
    });
  } catch (err) {
    console.error("[WhatsApp webhook error]", err);
  }
});

// GET queue orders
router.get("/whatsapp/queue", authenticate, requireRole(...QUEUE_ROLES), async (req, res): Promise<void> => {
  const branchId = req.query.branchId ? parseInt(req.query.branchId as string, 10) : undefined;
  let rows = await db.select().from(ordersTable).where(eq(ordersTable.status, "queue")).orderBy(ordersTable.createdAt);
  if (branchId) rows = rows.filter(o => o.branchId === branchId);
  res.json(rows);
});

// Claim queue order
router.post("/whatsapp/queue/:id/claim", authenticate, requireRole(...QUEUE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { userId } = req.body;
  const [current] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (current.intakeClaimedByUserId && current.intakeClaimedByUserId !== userId) {
    res.status(409).json({ error: "Already claimed by another staff member" }); return;
  }
  await db.update(ordersTable)
    .set({ intakeClaimedByUserId: userId, intakeClaimedAt: new Date() })
    .where(eq(ordersTable.id, id));
  res.json({ ok: true });
});

// Confirm queue order (transition to pending_acceptance)
router.post("/whatsapp/queue/:id/confirm", authenticate, requireRole(...QUEUE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { userId, customerName, deliveryAddress, items } = req.body;
  if (!items?.length) { res.status(400).json({ error: "Items required" }); return; }
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id));
  if (!order) { res.status(404).json({ error: "Not found" }); return; }

  const total = items.reduce(
    (s: number, i: { unitPrice: number; quantity: number }) => s + i.unitPrice * i.quantity,
    0
  );
  await db.update(ordersTable).set({
    status: "pending_acceptance",
    customerNameDirect: customerName,
    deliveryAddress,
    totalAed: String(total),
    relayedByUserId: userId,
  }).where(eq(ordersTable.id, id));

  await db.insert(orderItemsTable).values(
    items.map((i: { menuItemId: number; quantity: number; unitPrice: number }) => ({
      orderId: id,
      menuItemId: i.menuItemId,
      quantity: i.quantity,
      unitPrice: String(i.unitPrice),
    }))
  );
  await db.insert(orderStatusHistoryTable).values({
    orderId: id,
    status: "pending_acceptance",
    changedBy: userId,
    note: `Confirmed from WhatsApp queue #${order.queueNumber}`,
  });

  tryEmitTo(`branch:${order.branchId}:kitchen`, "order:new", {
    orderId: id,
    orderCode: order.orderCode,
    status: "pending_acceptance",
  });
  res.json({ ok: true });
});

// Dismiss queue order
router.post("/whatsapp/queue/:id/dismiss", authenticate, requireRole(...QUEUE_ROLES), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { userId, reason } = req.body;
  if (!reason) { res.status(400).json({ error: "Reason required" }); return; }
  await db.update(ordersTable).set({ status: "dismissed" }).where(eq(ordersTable.id, id));
  await db.insert(orderStatusHistoryTable).values({
    orderId: id,
    status: "dismissed",
    changedBy: userId,
    note: `Dismissed: ${reason}`,
  });
  res.json({ ok: true });
});

// Allowlist of hostname suffixes from which we will proxy Twilio media.
// We intentionally forward Basic auth credentials only to these Twilio-owned domains.
const TWILIO_MEDIA_HOSTS = [
  ".twilio.com",
  ".twiliocdn.com",
  ".twimg.com", // Twilio WhatsApp profile images
];

function isTwilioMediaUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" && TWILIO_MEDIA_HOSTS.some(suffix => parsed.hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

// Media proxy — streams Twilio voice note audio to the browser (avoids CORS + auth issues).
// Only proxies URLs on Twilio-owned domains to prevent SSRF and credential leakage.
router.get("/whatsapp/media", authenticate, requireRole(...QUEUE_ROLES), async (req, res): Promise<void> => {
  const url = req.query.url as string;
  if (!url || !isTwilioMediaUrl(url)) {
    res.status(400).json({ error: "URL must be a Twilio media URL" }); return;
  }
  try {
    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const headers: Record<string, string> = {};
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      headers["Authorization"] = "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    }
    const upstream = await fetch(url, { headers });
    if (!upstream.ok) { res.status(upstream.status).send("Media fetch failed"); return; }
    const contentType = upstream.headers.get("content-type") ?? "audio/ogg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    const arrayBuf = await upstream.arrayBuffer();
    res.end(Buffer.from(arrayBuf));
  } catch {
    res.status(502).json({ error: "Could not fetch media" });
  }
});

export default router;
