import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, missingRoute } from "./middleware/error.js";
import { logger } from "./shared/logging/logger.js";
import { paymentRoutes } from "./modules/payments/routes.js";
import { webhookRoutes } from "./modules/webhooks/routes.js";
import { reconciliationRoutes } from "./modules/reconciliation/routes.js";
import { ledgerRoutes } from "./modules/ledger/routes.js";
import { openapi } from "./openapi.js";
import swaggerUi from "swagger-ui-express";
export type AppOptions = {
  secret: string;
  simulatorEnabled: boolean;
};
export function createApp(db: PrismaClient, options: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(helmet());
  app.use((req, res, next) => {
    const supplied = req.header("x-request-id");
    req.correlationId =
      supplied && /^[A-Za-z0-9_-]{1,64}$/.test(supplied)
        ? supplied
        : randomUUID();
    res.setHeader("x-request-id", req.correlationId);
    next();
  });
  app.use(pinoHttp({ logger, autoLogging: false }));
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.get("/openapi.json", (_req, res) => res.json(openapi));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));
  // Provider needs the exact signed bytes. Separate raw-body middleware from JSON routes.
  if (options.simulatorEnabled)
    app.use(
      "/api/v1/webhooks/provider",
      express.raw({ type: "application/json", limit: "32kb" }),
      webhookRoutes(db, options.secret),
    );
  app.use(express.json({ limit: "128kb" }));
  const auth = authenticate(db);
  app.use("/api/v1/payments", auth, paymentRoutes(db));
  app.use("/api/v1/reconciliation", auth, reconciliationRoutes(db));
  app.use("/api/v1/ledger", auth, ledgerRoutes(db));
  app.use(missingRoute);
  app.use(errorHandler);
  return app;
}
