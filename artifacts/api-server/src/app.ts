import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// CORS: read allowed origins from FRONTEND_URL (comma-separated).
// In production, FRONTEND_URL must be set — fall back only in development.
function buildAllowedOrigins(): string[] {
  const raw = process.env["FRONTEND_URL"];
  if (raw) return raw.split(",").map((o) => o.trim()).filter(Boolean);
  if (process.env["NODE_ENV"] === "production") return []; // fail closed
  return ["http://localhost:5173", "http://localhost:3000", "http://localhost:25390"];
}

const allowedOrigins = buildAllowedOrigins();

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server health checks)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
  credentials: true,
};

// Handle CORS preflight OPTIONS for ALL routes BEFORE any route registration.
// Without this, browsers abort CORS preflight before the route handler runs.
app.options("*", cors(corsOptions));
app.use(cors(corsOptions));

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

// Global error handler — must be registered AFTER all routes.
// In production, hide internal error details from the client.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled server error");
  const isDev = process.env["NODE_ENV"] !== "production";
  res.status(500).json({
    error: isDev ? err.message : "Internal server error",
    ...(isDev && { stack: err.stack }),
  });
});

export default app;
