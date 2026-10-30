import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../shared/errors/AppError.js";
import { ingestEvent, verifyWebhook } from "./service.js";
export function webhookRoutes(db: PrismaClient, secret: string) {
  const router = Router();
  router.post(
    "/:provider",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (req.params.provider !== "simulator")
          throw new AppError(404, "NOT_FOUND", "Unknown provider");
        if (!Buffer.isBuffer(req.body))
          throw new AppError(
            415,
            "UNSUPPORTED_MEDIA_TYPE",
            "Expected JSON bytes",
          );
        if (
          !verifyWebhook(secret, req.body, req.header("x-simulator-signature"))
        )
          throw new AppError(
            401,
            "INVALID_SIGNATURE",
            "Webhook signature invalid",
          );
        let body: unknown;
        try {
          body = JSON.parse(req.body.toString("utf8")) as unknown;
        } catch {
          throw new AppError(400, "BAD_JSON", "Malformed JSON");
        }
        const status = await ingestEvent(db, "simulator", body);
        res.status(200).json({ data: { status } });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}
