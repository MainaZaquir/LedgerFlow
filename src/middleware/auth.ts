import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { hashApiKey } from "../modules/merchants/api-keys.js";
import { AppError } from "../shared/errors/AppError.js";
declare global {
  namespace Express {
    interface Request {
      merchantId?: string;
      correlationId?: string;
    }
  }
}
export function authenticate(db: PrismaClient) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const header = req.header("authorization");
      if (
        !header?.startsWith("Bearer ") ||
        !/^Bearer lf_test_[A-Za-z0-9_-]{43}$/.test(header)
      )
        throw new AppError(401, "UNAUTHORIZED", "Valid API key required");
      const key = await db.apiKey.findUnique({
        where: { hash: hashApiKey(header.slice(7)) },
      });
      if (!key || key.revokedAt)
        throw new AppError(401, "UNAUTHORIZED", "Invalid API key");
      req.merchantId = key.merchantId;
      next();
    } catch (e) {
      next(e);
    }
  };
}
export function merchantId(req: Request): string {
  if (!req.merchantId)
    throw new AppError(401, "UNAUTHORIZED", "Authentication required");
  return req.merchantId;
}
