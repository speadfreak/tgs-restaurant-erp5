/**
 * Google Drive API v3 client using OAuth 2.0 (a real Google account's own
 * refresh token) — NOT a service account. Service accounts have 0 storage
 * quota of their own, so uploads always fail with "Service Accounts do not
 * have storage quota" unless routed through a Workspace Shared Drive or
 * domain-wide delegation, neither of which is available on a personal Gmail
 * account. Authenticating as a real user's OAuth client instead lets uploads
 * use that account's normal Drive storage.
 *
 * Credentials come from Settings (google_drive_client_id /
 * google_drive_client_secret / google_drive_refresh_token / google_drive_folder_id),
 * matching the same encrypted-settings pattern used for Twilio/SendGrid/Teams.
 */
import { google } from "googleapis";
import { Readable } from "stream";
import { getSetting } from "./settings";

export async function getGoogleDriveClient() {
  const clientId = await getSetting("google_drive_client_id");
  const clientSecret = await getSetting("google_drive_client_secret");
  const refreshToken = await getSetting("google_drive_refresh_token");
  const folderId = await getSetting("google_drive_folder_id");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google Drive OAuth credentials not configured in Settings → Google Drive & Backup");
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  const drive = google.drive({ version: "v3", auth });
  return { drive, folderId };
}

export async function uploadFileToDrive(
  fileName: string,
  buffer: Buffer,
  mimeType: string,
  folderId: string | null,
): Promise<{ fileId: string; webViewLink: string }> {
  const { drive } = await getGoogleDriveClient();

  const fileMetadata: { name: string; parents?: string[] } = { name: fileName };
  if (folderId) fileMetadata.parents = [folderId];

  const media = {
    mimeType,
    body: Readable.from(buffer),
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: "id, webViewLink",
  });

  if (!response.data.id || !response.data.webViewLink) {
    throw new Error("Google Drive did not return a file ID / link");
  }

  return {
    fileId: response.data.id,
    webViewLink: response.data.webViewLink,
  };
}
