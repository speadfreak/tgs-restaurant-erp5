/**
 * Microsoft Teams Incoming Webhook notifications.
 * Uses Adaptive Card format with TG's Restaurant amber branding.
 * Silently skips if no webhook URL is configured in settings.
 */

import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

async function getTeamsWebhookUrl(): Promise<string | null> {
  try {
    const [row] = await db.select().from(settingsTable)
      .where(eq(settingsTable.key, "teams_webhook_url"));
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Send a notification card to the configured Teams channel.
 * @param title   Bold title line shown at top of card
 * @param body    Main message body (plain text)
 * @param color   Hex accent color; defaults to TG amber (#F59E0B)
 */
export async function sendTeamsNotification(
  title: string,
  body: string,
  color = "#F59E0B",
): Promise<void> {
  const webhookUrl = await getTeamsWebhookUrl();
  if (!webhookUrl) return; // not configured — skip silently

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: `🍽️ TG's Restaurant`,
              size: "Small",
              color: "Warning",
              weight: "Bolder",
            },
            {
              type: "TextBlock",
              text: title,
              size: "Medium",
              weight: "Bolder",
              wrap: true,
              color: "Accent",
            },
            {
              type: "TextBlock",
              text: body,
              size: "Default",
              wrap: true,
              spacing: "Small",
            },
          ],
          msteams: { width: "Full" },
        },
      },
    ],
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Teams webhook returned non-OK status");
    }
  } catch (err) {
    logger.warn({ err }, "Teams notification failed — skipping");
  }
}
