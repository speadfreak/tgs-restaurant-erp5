/**
 * Google Drive API v3 client using a Service Account — no interactive OAuth
 * needed, works entirely server-side. Credentials come from Settings
 * (google_drive_client_email / google_drive_private_key / google_drive_folder_id),
 * matching the same encrypted-settings pattern used for Twilio/SendGrid/Teams.
 */
import { google } from "googleapis";
import { Readable } from "stream";
import { getSetting } from "./settings";

export async function getGoogleDriveClient() {
  const clientEmail = await getSetting("google_drive_client_email");
  const privateKey = await getSetting("google_drive_private_key");
  const folderId = await getSetting("google_drive_folder_id");

  if (!clientEmail || !privateKey) {
    throw new Error("Google Drive credentials not configured in Settings → Google Drive & Backup");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"), // fix escaped newlines from pasted JSON
    },
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

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
