import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// CORS: read allowed origins from FRONTEND_URL (comma-separated).
// In production, FRONTEND_URL must be set — the server will refuse to start
// without it (see index.ts startup validation). Localhost fallback is only
// used in development so engineers never need to set this locally.
function buildAllowedOrigins(): string[] {
  const raw = process.env["FRONTEND_URL"];
  if (raw) return raw.split(",").map((o) => o.trim()).filter(Boolean);
  if (process.env["NODE_ENV"] === "production") return []; // fail closed
  return ["http://localhost:5173", "http://localhost:3000", "http://localhost:25390"];
}

const allowedOrigins = buildAllowedOrigins();

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, server-to-server health checks)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin '${origin}' not allowed`));
      }
    },
    credentials: true,
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
