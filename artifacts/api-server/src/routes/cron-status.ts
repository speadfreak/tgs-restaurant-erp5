import { Router } from "express";
import { db, cronJobLogsTable, branchesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  runDailyLotteryDrawForBranch,
  retryLuckyNumbers,
  logQueueReset,
  checkOverdueShipments,
} from "../lib/cron-jobs";
import { authenticate, requireRole, ADMIN_ROLES } from "../middlewares/auth";

const router: Router = Router();
router.use(authenticate, requireRole(...ADMIN_ROLES));

const JOB_DEFS = [
  { name: "daily_lottery_draw",  label: "Daily Lottery Draw",   schedule: "Daily at 22:00 UAE (18:00 UTC)", icon: "🎰" },
  { name: "lucky_number_retry",  label: "Lucky Number Retry",   schedule: "Every 15 minutes",               icon: "🔄" },
  { name: "queue_number_reset",  label: "Queue Reset Log",      schedule: "Daily at midnight UAE",           icon: "🔃" },
  { name: "import_overdue_check",label: "Import Overdue Check", schedule: "Daily at 09:00 UAE (05:00 UTC)", icon: "📦" },
];

router.get("/cron-jobs/status", async (req, res): Promise<void> => {
  const results = await Promise.all(
    JOB_DEFS.map(async (job) => {
      const logs = await db
        .select()
        .from(cronJobLogsTable)
        .where(eq(cronJobLogsTable.jobName, job.name))
        .orderBy(desc(cronJobLogsTable.startedAt))
        .limit(5);
      return {
        name: job.name,
        label: job.label,
        schedule: job.schedule,
        icon: job.icon,
        lastRun: logs[0]
          ? {
              startedAt: logs[0].startedAt.toISOString(),
              completedAt: logs[0].completedAt?.toISOString() ?? null,
              status: logs[0].status,
              message: logs[0].message ?? null,
              errorDetails: logs[0].errorDetails ?? null,
            }
          : null,
        recentRuns: logs.map((l) => ({
          startedAt: l.startedAt.toISOString(),
          status: l.status,
          message: l.message ?? null,
        })),
      };
    })
  );
  res.json(results);
});

router.post("/cron-jobs/:name/trigger", async (req, res): Promise<void> => {
  const { name } = req.params;
  const knownJob = JOB_DEFS.find((j) => j.name === name);
  if (!knownJob) { res.status(404).json({ error: "Unknown job name" }); return; }

  const [logRow] = await db
    .insert(cronJobLogsTable)
    .values({ jobName: name, status: "running", message: "Manually triggered via ERP" })
    .returning();

  try {
    switch (name) {
      case "daily_lottery_draw": {
        const branches = await db.select({ id: branchesTable.id }).from(branchesTable);
        for (const b of branches) await runDailyLotteryDrawForBranch(b.id);
        break;
      }
      case "lucky_number_retry":
        await retryLuckyNumbers();
        break;
      case "queue_number_reset":
        await logQueueReset();
        break;
      case "import_overdue_check":
        await checkOverdueShipments();
        break;
    }
    await db
      .update(cronJobLogsTable)
      .set({ status: "success", completedAt: new Date(), message: "Manual trigger completed" })
      .where(eq(cronJobLogsTable.id, logRow.id));
    res.json({ ok: true, jobName: name });
  } catch (err) {
    await db
      .update(cronJobLogsTable)
      .set({ status: "failed", completedAt: new Date(), errorDetails: String(err) })
      .where(eq(cronJobLogsTable.id, logRow.id));
    res.status(500).json({ error: String(err) });
  }
});

export default router;
