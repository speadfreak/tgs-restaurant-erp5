import { Router } from "express";
import { authenticate, requireRole } from "../middlewares/auth";
import { runWeeklyBackup } from "../lib/weekly-backup";
import { db, backupLogsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: Router = Router();
router.use("/backup", authenticate, requireRole("super_admin"));

// GET /api/backup/logs — last 20 backup history entries
router.get("/backup/logs", async (_req, res): Promise<void> => {
  const logs = await db.select().from(backupLogsTable).orderBy(desc(backupLogsTable.createdAt)).limit(20);
  res.json(logs);
});

// POST /api/backup/run — manually trigger backup now (runs in background, 30-60s)
router.post("/backup/run", (_req, res): void => {
  res.json({ message: "Backup started. Check backup history in a few minutes." });

  runWeeklyBackup()
    .then((result) => console.log("[Manual Backup]", result))
    .catch((err) => console.error("[Manual Backup] Error:", err));
});

// GET /api/backup/test-drive — test Google Drive connection
router.get("/backup/test-drive", async (_req, res): Promise<void> => {
  try {
    const { getGoogleDriveClient } = await import("../lib/google-drive");
    const { drive } = await getGoogleDriveClient();
    const about = await drive.about.get({ fields: "user" });
    res.json({
      success: true,
      connectedAs: about.data.user?.emailAddress,
      message: "Google Drive connection successful",
    });
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Connection failed" });
  }
});

export default router;
