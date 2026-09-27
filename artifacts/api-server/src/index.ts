import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initSocket } from "./lib/socket";
import { startCronJobs } from "./lib/cron-jobs";
import { ensureStreakSchema } from "./lib/streak-schema-bootstrap";

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  await ensureStreakSchema();
  const httpServer = createServer(app);
  initSocket(httpServer);

  httpServer.listen(port, "0.0.0.0", (err?: Error) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening with Socket.IO");
    startCronJobs();
  });
}

startServer().catch((err) => {
  logger.error({ err }, "Failed to initialize API schema");
  process.exit(1);
});
